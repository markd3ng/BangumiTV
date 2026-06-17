import { Hono } from 'hono'
import { KVStorage } from '../src/storage/kv'
import { handleCollections } from '../src/api/collections'
import { handleCalendar } from '../src/api/calendar'
import { handleConfig } from '../src/api/config'
import { runSync } from '../src/sync/cron'

interface Env {
  BANGUMI_KV: KVNamespace
  BANGUMI_R2: R2Bucket
  SYNC_MODE: string
  NSFW_SHOW: string
  BANGUMI_TOKEN: string
  BANGUMI_USERS: string
  BANGUMI_PRIMARY_USER?: string
  BANGUMI_CLIENT_ID?: string
  BANGUMI_CLIENT_SECRET?: string
  CRON_SECRET: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS
app.use('*', async (c, next) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*')
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type')
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.res.headers })
  await next()
})

// 公开 API
app.get('/api/collections', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCollections(storage, new URL(c.req.url))
})

app.get('/api/calendar', async (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCalendar(storage)
})

app.get('/api/config', (c) => {
  return handleConfig(new URL(c.req.url), { NSFW_SHOW: c.env.NSFW_SHOW })
})

// Cron 同步
app.post('/__cron/sync', async (c) => {
  const secret = c.req.header('X-Cron-Secret')
  if (secret !== c.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 })

  const storage = new KVStorage(c.env.BANGUMI_KV)
  const users = c.env.BANGUMI_USERS.split(',').map(s => s.trim()).filter(Boolean)

  try {
    await runSync(storage, c.env.BANGUMI_TOKEN, users, c.env.BANGUMI_PRIMARY_USER, c.env.SYNC_MODE || 'merge')
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Sync error:', err)
    return new Response('Sync failed', { status: 500 })
  }
})

export default app
