/// <reference path="../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { KVStorage } from './storage/kv'
import { R2ImageStore } from './image/store'
import { handleCollections } from './api/collections'
import { handleCalendar } from './api/calendar'
import { handleConfig } from './api/config'
import { runSync } from './cron'
import { compareAccounts } from './manage/compare'
import { executeSync } from './manage/sync-write'
import { getSyncLockStub } from './sync-lock'
import type { AcquireResponse } from './sync-lock'
import { getOAuthRedirectUrl, exchangeCode } from './manage/oauth'
import { handleImage } from './image/proxy'
import { getSnapshot } from './storage/snapshot'
import manageHtml from './manage/index.html'
import indexHtml from './html'
import bangumiJs from './js'
import bangumiCss from './css'
import { BgmHttpError, BgmTimeoutError, BgmNetworkError } from '@bangumi-tv/shared'
import type { OAuthPurpose } from './manage/security'
import {
  authorizeManageRequest,
  callbackPageCsp,
  createOAuthState,
  createHealthFailureLog,
  createManageErrorLog,
  createSyncFailureLog,
  manageHeaders,
  managePageCsp,
  oauthCallbackHtml,
  parseOAuthExchangeBody,
  parseOAuthPurposeBody,
  publicError,
  verifyOAuthState,
} from './manage/security'

function errorToResponse(route: string, err: unknown): Response {
  const log = createManageErrorLog(route, err)
  console.error(JSON.stringify(log))

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

// ── 请求级调试埋点：method path status duration ──
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

// 主页：apiUrl 由前端自动取 window.location.origin，无需硬编码域名。
app.get('/', () => {
  return new Response(indexHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

// 静态资源（Worker 提供主页引用的 JS/CSS，避免跨域到 Pages）。
app.get('/src/bangumi.js', () => {
  return new Response(bangumiJs, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } })
})
app.get('/src/bangumi.css', () => {
  return new Response(bangumiCss, { headers: { 'Content-Type': 'text/css; charset=utf-8' } })
})

// 公开 API
app.get('/api/collections', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    return await handleCollections(storage, new URL(c.req.url), c.env.NSFW_SHOW !== 'false')
  } catch (err) {
    console.error(JSON.stringify({ event: 'api_error', route: '/api/collections', kind: err instanceof Error ? err.name : 'Unknown', at: new Date().toISOString() }))
    return Response.json({ data: [], total: 0, page: 1, limit: 24, types: {} }, { status: 200 })
  }
})

app.get('/api/calendar', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    return await handleCalendar(storage, c.env.NSFW_SHOW !== 'false')
  } catch (err) {
    console.error(JSON.stringify({ event: 'api_error', route: '/api/calendar', kind: err instanceof Error ? err.name : 'Unknown', at: new Date().toISOString() }))
    return Response.json([], { status: 200 })
  }
})

app.get('/api/config', (c) => {
  return handleConfig(new URL(c.req.url), { NSFW_SHOW: c.env.NSFW_SHOW })
})

// 排障：健康检查 + 同步状态。
app.get('/api/health', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    const snap = await getSnapshot(storage)
    const lastSuccess = await storage.get<string>('sync:last_success')
      console.log(JSON.stringify({ event: 'health_ok', has_snapshot: !!snap, last_sync: lastSuccess || null, at: new Date().toISOString() }))
    return Response.json({
      ok: true,
      data: {
        collections: snap ? { updated_at: snap.collections.updated_at, types: summarize(snap.collections) } : null,
        calendar: snap ? snap.calendar.length + ' days' : null,
        last_sync: lastSuccess || null,
      },
    })
  } catch (err) {
    const log = createHealthFailureLog(err)
    console.error(JSON.stringify(log))
    return Response.json({ ok: false }, { status: 500 })
  }
})

// 图片代理
app.get('/image/*', (c) => {
  return handleImage({ BANGUMI_R2: c.env.BANGUMI_R2 }, c.req.raw)
})

// 管理页面
app.get('/manage', () => {
  return new Response(manageHtml, {
    headers: {
      ...manageHeaders(managePageCsp()),
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
})

app.get('/manage/callback', () => {
  return new Response(oauthCallbackHtml(), {
    headers: {
      ...manageHeaders(callbackPageCsp()),
      'Content-Type': 'text/html; charset=utf-8',
    },
  })
})

app.use('/api/manage/*', async (c, next) => {
  const denied = await authorizeManageRequest(c.req.raw, c.env.MANAGE_SECRET)
  if (denied) {
    console.warn(JSON.stringify({
      event: 'manage_auth_denied',
      status: denied.status,
      has_secret: !!c.req.header('X-Manage-Secret'),
      origin: c.req.header('Origin') || null,
      at: new Date().toISOString(),
    }))
    return denied
  }
  await next()
  for (const [name, value] of Object.entries(manageHeaders())) {
    c.header(name, String(value))
  }
})

app.post('/api/manage/oauth-url', async (c) => {
  const purpose: OAuthPurpose | null = parseOAuthPurposeBody(await c.req.json().catch(() => null))
  if (!purpose) {
    console.warn(JSON.stringify({ event: 'manage_input_error', route: '/api/manage/oauth-url', reason: 'invalid_purpose', at: new Date().toISOString() }))
    return publicError(400, 'INVALID_REQUEST')
  }
  if (!c.env.BANGUMI_CLIENT_ID) {
    console.warn(JSON.stringify({ event: 'manage_input_error', route: '/api/manage/oauth-url', reason: 'oauth_not_configured', at: new Date().toISOString() }))
    return publicError(503, 'OAUTH_NOT_CONFIGURED')
  }
  const created = await createOAuthState(c.env.MANAGE_SECRET!, purpose)
  const redirectUri = `${new URL(c.req.url).origin}/manage/callback`
	  console.log(JSON.stringify({ event: 'manage_oauth_url', purpose, at: new Date().toISOString() }))
  return Response.json({
    url: getOAuthRedirectUrl(c.env.BANGUMI_CLIENT_ID, redirectUri, created.state),
    state: created.state,
    nonce: created.nonce,
  })
})

app.post('/api/manage/exchange', async (c) => {
  const body = parseOAuthExchangeBody(await c.req.json().catch(() => null))
  if (!body) {
    console.warn(JSON.stringify({ event: 'manage_input_error', route: '/api/manage/exchange', reason: 'invalid_body', at: new Date().toISOString() }))
    return publicError(400, 'INVALID_REQUEST')
  }
  const state = await verifyOAuthState(c.env.MANAGE_SECRET!, body.state)
  if (!state) {
    console.warn(JSON.stringify({ event: 'manage_input_error', route: '/api/manage/exchange', reason: 'invalid_oauth_state', at: new Date().toISOString() }))
    return publicError(400, 'INVALID_OAUTH_STATE')
  }
  if (!c.env.BANGUMI_CLIENT_ID || !c.env.BANGUMI_CLIENT_SECRET) {
    console.warn(JSON.stringify({ event: 'manage_input_error', route: '/api/manage/exchange', reason: 'oauth_not_configured', at: new Date().toISOString() }))
    return publicError(503, 'OAUTH_NOT_CONFIGURED')
  }

  try {
    const result = await exchangeCode(
      c.env.BANGUMI_CLIENT_ID,
      c.env.BANGUMI_CLIENT_SECRET,
      body.code,
      `${new URL(c.req.url).origin}/manage/callback`,
    )
    if (state.purpose === 'cron') {
      const storage = new KVStorage(c.env.BANGUMI_KV)
      await storage.put('bgm:tokens', {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      })
	      console.log(JSON.stringify({ event: 'manage_oauth_exchange', purpose: 'cron', at: new Date().toISOString() }))
      return Response.json({ ok: true })
    }
	    console.log(JSON.stringify({ event: 'manage_oauth_exchange', purpose: state.purpose, has_user_id: true, at: new Date().toISOString() }))
    return Response.json({ access_token: result.access_token, user_id: result.user_id })
  } catch (err) {
    return errorToResponse('/api/manage/exchange', err)
  }
})

app.post('/api/manage/compare', async (c) => {
  try {
    const body = await c.req.json()
    const result = await compareAccounts(body.tokenA || '', body.userA || '', body.tokenB || '', body.userB || '')
	    console.log(JSON.stringify({ event: 'manage_compare', user_a: body.userA || '', user_b: body.userB || '', total_a: result.userA.total, total_b: result.userB.total, common: result.common, diffs: result.differences.length, at: new Date().toISOString() }))
    return Response.json(result)
  } catch (err) {
    return errorToResponse('/api/manage/compare', err)
  }
})

app.post('/api/manage/sync', async (c) => {
  try {
    const body = await c.req.json()
    const results = await executeSync(body.tokenA, body.from, body.tokenB, body.to, {
      mode: body.mode,
      from: body.from,
      to: body.to,
      subject_ids: body.subject_ids,
    }, c.env as { SYNCLOCK: DurableObjectNamespace })
	    const syncOk = results.filter((r: any) => r.status === 'ok').length;
	    const syncErr = results.filter((r: any) => r.status === 'error').length;
	    console.log(JSON.stringify({ event: 'manage_sync', mode: body.mode, total: results.length, ok: syncOk, errors: syncErr, at: new Date().toISOString() }))
    return Response.json(results)
  } catch (err) {
    return errorToResponse('/api/manage/sync', err)
  }
})

// 清除 KV 中持久化的 cron token（重新授权前调用）。
app.delete('/api/manage/cron-token', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  try {
    await storage.delete('bgm:tokens')
	    console.log(JSON.stringify({ event: 'manage_cron_token_deleted', at: new Date().toISOString() }))
    return Response.json({ ok: true })
  } catch (err) {
    return errorToResponse('/api/manage/cron-token', err)
  }
})

// HTTP 触发的手动同步（需要密钥）。
app.post('/__cron/sync', async (c) => {
  const secret = c.req.header('X-Cron-Secret')
  if (secret !== c.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 })

  const storage = new KVStorage(c.env.BANGUMI_KV)
  const imageStore = new R2ImageStore(c.env.BANGUMI_R2)
  const users = c.env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)

  // 获取同步锁
  const lockStub = getSyncLockStub(c.env)
  const acquireRes = await lockStub.fetch(new Request('http://do/acquire'))
  const { acquired } = await acquireRes.json() as AcquireResponse
  if (!acquired) {
    return new Response('Conflict: sync already in progress', { status: 409 })
  }

  try {
    await runSync(storage, imageStore, {
      BANGUMI_TOKEN: c.env.BANGUMI_TOKEN,
      BANGUMI_REFRESH_TOKEN: c.env.BANGUMI_REFRESH_TOKEN,
      BANGUMI_CLIENT_ID: c.env.BANGUMI_CLIENT_ID,
      BANGUMI_CLIENT_SECRET: c.env.BANGUMI_CLIENT_SECRET,
      BANGUMI_USERS: users,
      BANGUMI_PRIMARY_USER: c.env.BANGUMI_PRIMARY_USER,
      SYNC_MODE: c.env.SYNC_MODE || 'merge',
    })
    await storage.put('sync:last_success', new Date().toISOString())
    await storage.delete('sync:last_error')
	    console.log(JSON.stringify({ event: 'cron_sync_manual_ok', users: users.length, at: new Date().toISOString() }))
    return new Response('OK', { status: 200 })
  } catch (err) {
    const log = createSyncFailureLog('manual', err)
    console.error(JSON.stringify(log))
    await storage.put('sync:last_error', err instanceof Error ? err.message : String(err))
    return new Response('Sync failed', { status: 500 })
  } finally {
    await lockStub.fetch(new Request('http://do/release'))
  }
})

/** Cloudflare Cron Triggers 入口：每 4 小时触发一次自动同步。 */
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const storage = new KVStorage(env.BANGUMI_KV)
  const imageStore = new R2ImageStore(env.BANGUMI_R2)
  const users = env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)

  // 尝试获取锁，失败则跳过本次执行
  const lockStub = getSyncLockStub(env)
  const acquireRes = await lockStub.fetch(new Request('http://do/acquire'))
  const { acquired } = await acquireRes.json() as AcquireResponse
  if (!acquired) {
    console.warn('sync: cron skipped — another sync is in progress')
    return
  }

  try {
    ctx.waitUntil(
      runSync(storage, imageStore, {
        BANGUMI_TOKEN: env.BANGUMI_TOKEN,
        BANGUMI_REFRESH_TOKEN: env.BANGUMI_REFRESH_TOKEN,
        BANGUMI_CLIENT_ID: env.BANGUMI_CLIENT_ID,
        BANGUMI_CLIENT_SECRET: env.BANGUMI_CLIENT_SECRET,
        BANGUMI_USERS: users,
        BANGUMI_PRIMARY_USER: env.BANGUMI_PRIMARY_USER,
        SYNC_MODE: env.SYNC_MODE || 'merge',
      }).then(async () => {
        await storage.put('sync:last_success', new Date().toISOString())
        await storage.delete('sync:last_error')
      }).catch(async (err) => {
        const log = createSyncFailureLog('scheduled', err)
        console.error(JSON.stringify(log))
        await storage.put('sync:last_error', err instanceof Error ? err.message : String(err))
      }).finally(async () => {
        await lockStub.fetch(new Request('http://do/release'))
      }),
    )
  } catch (e) {
    // ctx.waitUntil 同步抛出异常时锁不会通过 .finally() 释放，需在此释放
    await lockStub.fetch(new Request('http://do/release'))
    throw e
  }
}

export { SyncLock } from './sync-lock'

export default {
  fetch: app.fetch,
  scheduled,
}
