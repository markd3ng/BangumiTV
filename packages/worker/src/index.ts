/// <reference path="../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { KVStorage } from './storage/kv'
import { handleCollections } from './api/collections'
import { handleCalendar } from './api/calendar'
import { handleConfig } from './api/config'
import { compareAccounts } from './sync/compare'
import { executeSync } from './sync/apply'
import { BgmPlatformClient, type PlatformId } from '@bangumi-tv/shared'
import type { PlatformClient } from '@bangumi-tv/shared'
import { handleImage } from './image/proxy'
import { getSnapshot } from './storage/snapshot'
import indexHtml from './html'
import bangumiJs from './js'
import bangumiCss from './css'
import { BgmHttpError, BgmTimeoutError, BgmNetworkError } from '@bangumi-tv/shared'
import {
  createHealthFailureLog,
  createSyncRequestErrorLog,
  publicError,
  syncHeaders,
} from './sync/errors'

// ── KV 错误环形缓冲区 ──
const ERROR_RING_KEY = 'debug:errors'
const ERROR_RING_MAX = 50
const SYNC_OPERATION_PREFIX = 'sync:operation:'
const SYNC_OPERATION_TTL_SECONDS = 60 * 60 * 24

interface SyncOperationLog {
  id: string
  event: 'sync_operation'
  mode: string
  requested_count: number
  returned_count: number
  ok: number
  errors: number
  duration_ms: number
  at: string
  items: Array<{
    externalId: string
    title: string
    status: 'ok' | 'error'
    error?: string
  }>
}

function operationLogKey(id: string): string {
  return `${SYNC_OPERATION_PREFIX}${id}`
}

function createOperationId(): string {
  return crypto.randomUUID()
}

function syncOperationHeaders(id: string): Headers {
  const headers = new Headers(syncHeaders())
  headers.set('X-Sync-Operation-Id', id)
  headers.set('X-Sync-Operation-Url', `/api/sync/operations/${id}`)
  return headers
}

function createSyncOperationLog(
  id: string,
  mode: string,
  requestedCount: number,
  results: Array<{ externalId: string; title: string; status: 'ok' | 'error'; error?: string }>,
  durationMs: number,
): SyncOperationLog {
  const ok = results.filter((r) => r.status === 'ok').length
  const errors = results.filter((r) => r.status === 'error').length
  return {
    id,
    event: 'sync_operation',
    mode,
    requested_count: requestedCount,
    returned_count: results.length,
    ok,
    errors,
    duration_ms: durationMs,
    at: new Date().toISOString(),
    items: results.map((result) => ({
      externalId: result.externalId,
      title: result.title,
      status: result.status,
      ...(result.error ? { error: result.error } : {}),
    })),
  }
}

async function persistSyncOperationLog(kv: KVNamespace, log: SyncOperationLog): Promise<void> {
  await kv.put(operationLogKey(log.id), JSON.stringify(log), {
    expirationTtl: SYNC_OPERATION_TTL_SECONDS,
  })
}

async function appendErrorLog(storage: KVStorage, entry: unknown): Promise<void> {
  try {
    const existing = (await storage.get<any[]>(ERROR_RING_KEY)) || []
    existing.push(entry as Record<string, unknown>)
    if (existing.length > ERROR_RING_MAX) {
      existing.splice(0, existing.length - ERROR_RING_MAX)
    }
    await storage.put(ERROR_RING_KEY, existing)
  } catch {
    // KV 写入失败静默跳过，不影响主业务
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function errorToResponse(route: string, err: unknown, storage?: KVStorage): Response {
  const log = createSyncRequestErrorLog(route, err)
  console.error(JSON.stringify(log))
  if (storage) appendErrorLog(storage, log)

  if (err instanceof BgmHttpError) {
    if (err.status === 401 || err.status === 403) {
      return publicError(401, 'BGM_AUTH', err)
    }
    return publicError(502, 'BGM_UPSTREAM', err)
  }
  if (err instanceof BgmTimeoutError) {
    return publicError(504, 'BGM_TIMEOUT', err)
  }
  if (err instanceof BgmNetworkError) {
    return publicError(502, 'BGM_UPSTREAM', err)
  }
  if (err instanceof SyntaxError) {
    return publicError(400, 'INVALID_REQUEST', err)
  }
  return publicError(500, 'REQUEST_FAILED', err)
}

const app = new Hono<{ Bindings: Env }>()

// ── 请求级调试埋点 ──
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  console.log(JSON.stringify({
    event: 'request',
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    duration_ms: duration,
  }))
})

const publicCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] })
app.use('/api/collections', publicCors)
app.use('/api/calendar', publicCors)
app.use('/api/config', publicCors)
app.use('/api/health', publicCors)

/** 统计各收藏分类条目数，供 health/排障 使用。 */
function summarize(merged: any) {
  const keys = ['want', 'watched', 'watching', 'on_hold', 'dropped']
  const counts: Record<string, number> = {}
  let total = 0
  for (const k of keys) {
    const n = Array.isArray(merged[k]) ? merged[k].length : 0
    counts[k] = n
    total += n
  }
  counts._total = total
  return counts
}

// 主页
app.get('/', () => {
  return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

// 静态资源
app.get('/src/bangumi.js', () => {
  return new Response(bangumiJs, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } })
})
app.get('/src/bangumi.css', () => {
  return new Response(bangumiCss, { headers: { 'Content-Type': 'text/css; charset=utf-8' } })
})

// ── 公开 API ──
app.get('/api/collections', async (c) => {
  // Cache API: 避免每次从 KV 读 150KB+ 快照
  const cache = (caches as any).default as Cache
  const cacheKey = new Request(c.req.url)
  const cached = await cache.match(cacheKey)
  if (cached) return cached

  const storage = new KVStorage(c.env.BANGUMI_KV)
  const url = new URL(c.req.url)
  const type = url.searchParams.get('type') || 'watching'
  try {
    const res = await handleCollections(storage, url, c.env.NSFW_SHOW !== 'false')
    console.log(JSON.stringify({ event: 'api_collections', type, status: res.status, at: new Date().toISOString() }))
    const resBody = await res.text()
    const cachedRes = new Response(resBody, { status: res.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })
    c.executionCtx.waitUntil(cache.put(cacheKey, cachedRes.clone()))
    return cachedRes
  } catch (err) {
    const log = { event: 'api_error', route: '/api/collections', kind: err instanceof Error ? err.name : 'Unknown', message: errMsg(err), at: new Date().toISOString() }
    console.error(JSON.stringify(log))
    appendErrorLog(storage, log)
    return Response.json({ data: [], total: 0, page: 1, limit: 24, types: {} }, { status: 200 })
  }
})

app.get('/api/calendar', async (c) => {
  const calCache = (caches as any).default as Cache
  const calCacheKey = new Request(c.req.url)
  const calCached = await calCache.match(calCacheKey)
  if (calCached) return calCached

  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    const calRes = await handleCalendar(storage, c.env.NSFW_SHOW !== 'false')
    console.log(JSON.stringify({ event: 'api_calendar', status: calRes.status, at: new Date().toISOString() }))
    const calBody = await calRes.text()
    const calCachedRes = new Response(calBody, { status: calRes.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60' } })
    c.executionCtx.waitUntil(calCache.put(calCacheKey, calCachedRes.clone()))
    return calCachedRes
  } catch (err) {
    const log = { event: 'api_error', route: '/api/calendar', kind: err instanceof Error ? err.name : 'Unknown', message: errMsg(err), at: new Date().toISOString() }
    console.error(JSON.stringify(log))
    appendErrorLog(storage, log)
    return Response.json([], { status: 200 })
  }
})

app.get('/api/config', (c) => {
  const key = new URL(c.req.url).searchParams.get('key') || ''
  console.log(JSON.stringify({ event: 'api_config', key, at: new Date().toISOString() }))
  return handleConfig(new URL(c.req.url), { NSFW_SHOW: c.env.NSFW_SHOW })
})

// ── 健康检查 ──
app.get('/api/health', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    const snap = await getSnapshot(storage)
    const lastSuccess = await storage.get<string>('sync:last_success')
    const lastError = await storage.get<string>('sync:last_error')
    console.log(JSON.stringify({ event: 'health_ok', has_snapshot: !!snap, last_sync: lastSuccess || null, has_error: !!lastError, at: new Date().toISOString() }))
    return Response.json({
      ok: true,
      data: {
        collections: snap ? { updated_at: snap.collections.updated_at, types: summarize(snap.collections) } : null,
        calendar: snap ? snap.calendar.length + ' days' : null,
        last_sync: lastSuccess || null,
        last_error: lastError || null,
      },
    })
  } catch (err) {
    const log = createHealthFailureLog(err)
    console.error(JSON.stringify(log))
    appendErrorLog(storage, log)
    return Response.json({ ok: false }, { status: 500 })
  }
})

// 图片代理
app.get('/image/*', (c) => {
  return handleImage({ BANGUMI_R2: c.env.BANGUMI_R2 }, c.req.raw)
})

function getPlatformClient(platform: string): PlatformClient {
  if (platform === 'bgm' || !platform) return new BgmPlatformClient()
  throw new Error(`Unsupported platform: ${platform}`)
}

app.post('/api/sync/compare', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    const body = await c.req.json()
    const clientA = getPlatformClient(body.platformA || 'bgm')
    const clientB = getPlatformClient(body.platformB || 'bgm')
    const result = await compareAccounts(clientA, body.tokenA || '', clientB, body.tokenB || '')
    console.log(JSON.stringify({ event: 'sync_compare', platform_a: body.platformA || 'bgm', platform_b: body.platformB || 'bgm', total_a: result.userA.total, total_b: result.userB.total, common: result.common, diffs: result.differences.length, at: new Date().toISOString() }))
    return Response.json(result)
  } catch (err) {
    return errorToResponse('/api/sync/compare', err, storage)
  }
})

app.post('/api/sync/apply', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  const startedAt = Date.now()
  try {
    const body = await c.req.json()
    const operationId = createOperationId()
    const clientA = getPlatformClient(body.platformA || 'bgm')
    const clientB = getPlatformClient(body.platformB || 'bgm')
    const results = await executeSync(clientA, body.tokenA, clientB, body.tokenB, {
      mode: body.mode,
      from: body.from,
      to: body.to,
      subject_ids: body.subject_ids,
    }, c.env as { SYNCLOCK: DurableObjectNamespace })
    const syncOk = results.filter((r: any) => r.status === 'ok').length
    const syncErr = results.filter((r: any) => r.status === 'error').length
    const requestedCount = Array.isArray(body.subject_ids) ? body.subject_ids.length : results.length
    const operationLog = createSyncOperationLog(operationId, body.mode, requestedCount, results, Date.now() - startedAt)
    await persistSyncOperationLog(c.env.BANGUMI_KV, operationLog)
    console.log(JSON.stringify({ event: 'sync_apply', operation_id: operationId, mode: body.mode, total: results.length, ok: syncOk, errors: syncErr, at: new Date().toISOString() }))
    return Response.json(results, {
      headers: syncOperationHeaders(operationId),
    })
  } catch (err) {
    return errorToResponse('/api/sync/apply', err, storage)
  }
})

app.get('/api/sync/operations/:id', async (c) => {
  const id = c.req.param('id')
  if (!/^[0-9a-fA-F-]{36}$/.test(id)) {
    return Response.json({ ok: false, error: { code: 'INVALID_OPERATION_ID', message: 'Invalid operation id' } }, { status: 400, headers: syncHeaders() })
  }

  const storage = new KVStorage(c.env.BANGUMI_KV)
  const operation = await storage.get<SyncOperationLog>(operationLogKey(id))
  if (!operation) {
    return Response.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Operation log not found or expired' } }, { status: 404, headers: syncHeaders() })
  }

  return Response.json({ ok: true, operation }, { headers: syncHeaders() })
})


export { SyncLock } from './sync-lock'

export default {
  fetch: app.fetch
}
