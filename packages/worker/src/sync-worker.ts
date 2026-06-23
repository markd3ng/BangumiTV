/// <reference path="../worker-configuration.d.ts" />
import { KVStorage } from './storage/kv'
import { R2ImageStore } from './image/store'
import { runSync } from './cron'
import { getSyncLockStub } from './sync-lock'
import type { AcquireResponse } from './sync-lock'
import { createSyncFailureLog } from './manage/security'

// ── KV 错误环形缓冲区 ──
const ERROR_RING_KEY = 'debug:errors'
const ERROR_RING_MAX = 50

async function appendErrorLog(storage: KVStorage, entry: unknown): Promise<void> {
  try {
    const existing = (await storage.get<any[]>(ERROR_RING_KEY)) || []
    existing.push(entry as Record<string, unknown>)
    if (existing.length > ERROR_RING_MAX) {
      existing.splice(0, existing.length - ERROR_RING_MAX)
    }
    await storage.put(ERROR_RING_KEY, existing)
  } catch {
    // KV 写入失败静默跳过
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

// ── HTTP：手动触发同步 ──
async function fetch(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)

  if (url.pathname === '/__cron/sync' && request.method === 'POST') {
    const secret = request.headers.get('X-Cron-Secret')
    if (secret !== env.CRON_SECRET) return new Response('Unauthorized', { status: 401 })

    const storage = new KVStorage(env.BANGUMI_KV)
    const imageStore = new R2ImageStore(env.BANGUMI_R2)
    const users = env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)

    const lockStub = getSyncLockStub(env)
    const acquireRes = await lockStub.fetch(new Request('http://do/acquire'))
    const { acquired } = await acquireRes.json() as AcquireResponse
    if (!acquired) {
      return new Response('Conflict: sync already in progress', { status: 409 })
    }

    try {
      const result = await runSync(storage, imageStore, {
        BANGUMI_TOKEN: env.BANGUMI_TOKEN,
        BANGUMI_REFRESH_TOKEN: env.BANGUMI_REFRESH_TOKEN,
        BANGUMI_CLIENT_ID: env.BANGUMI_CLIENT_ID,
        BANGUMI_CLIENT_SECRET: env.BANGUMI_CLIENT_SECRET,
        BANGUMI_USERS: users,
        BANGUMI_PRIMARY_USER: env.BANGUMI_PRIMARY_USER,
        SYNC_MODE: env.SYNC_MODE || 'merge',
      })
      await storage.put('sync:last_success', new Date().toISOString())
      await storage.delete('sync:last_error')
      console.log(JSON.stringify({ event: 'cron_sync_manual_ok', users: users.length, generation: result.generation, at: new Date().toISOString() }))
      return new Response('OK', { status: 200 })
    } catch (err) {
      const log = createSyncFailureLog('manual', err)
      console.error(JSON.stringify(log))
      appendErrorLog(storage, log)
      await storage.put('sync:last_error', errMsg(err))
      return new Response('Sync failed', { status: 500 })
    } finally {
      await lockStub.fetch(new Request('http://do/release'))
    }
  }

  // 兼容旧版：也响应根路径以便调试
  if (url.pathname === '/health' || url.pathname === '/') {
    const storage = new KVStorage(env.BANGUMI_KV)
    const lastSuccess = await storage.get<string>('sync:last_success')
    const lastError = await storage.get<string>('sync:last_error')
    const errors = (await storage.get<any[]>(ERROR_RING_KEY)) || []
    return Response.json({
      worker: 'bangumi-tv-sync',
      last_sync: lastSuccess || null,
      last_error: lastError || null,
      error_log_count: errors.length,
    })
  }

  return new Response('Not found', { status: 404 })
}

// ── Cron 定时同步 ──
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const storage = new KVStorage(env.BANGUMI_KV)
  const imageStore = new R2ImageStore(env.BANGUMI_R2)
  const users = env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)

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
      }).then(async (result) => {
        await storage.put('sync:last_success', new Date().toISOString())
        await storage.delete('sync:last_error')
        console.log(JSON.stringify({ event: 'cron_sync_ok', users: users.length, generation: result.generation, at: new Date().toISOString() }))
      }).catch(async (err) => {
        const log = createSyncFailureLog('scheduled', err)
        console.error(JSON.stringify(log))
        appendErrorLog(storage, log)
        await storage.put('sync:last_error', errMsg(err))
      }).finally(async () => {
        await lockStub.fetch(new Request('http://do/release'))
      }),
    )
  } catch (e) {
    await lockStub.fetch(new Request('http://do/release'))
    throw e
  }
}

export { SyncLock } from './sync-lock'

export default { fetch, scheduled }
