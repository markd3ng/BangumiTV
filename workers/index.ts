import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { KVStorage } from '../src/storage/kv'
import { R2ImageStore } from '../src/image/store'
import { handleCollections } from '../src/api/collections'
import { handleCalendar } from '../src/api/calendar'
import { handleConfig } from '../src/api/config'
import { runSync } from '../src/sync/cron'
import { compareAccounts } from '../src/manage/compare'
import { executeSync } from '../src/manage/sync-write'
import { getOAuthRedirectUrl, exchangeCode } from '../src/manage/oauth'
import { handleImage } from '../src/image/proxy'
import manageHtml from '../manage/index.html'

interface Env {
  BANGUMI_KV: KVNamespace
  BANGUMI_R2: R2Bucket
  SYNC_MODE: string
  NSFW_SHOW: string
  BANGUMI_TOKEN: string
  BANGUMI_REFRESH_TOKEN?: string
  BANGUMI_USERS: string
  BANGUMI_PRIMARY_USER?: string
  BANGUMI_CLIENT_ID?: string
  BANGUMI_CLIENT_SECRET?: string
  CRON_SECRET: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS：使用 hono/cors 中间件，确保头会落到真实响应上（含 OPTIONS 预检）。
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type'],
}))

// 公开 API
app.get('/api/collections', (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCollections(storage, new URL(c.req.url), c.env.NSFW_SHOW !== 'false')
})

app.get('/api/calendar', (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCalendar(storage)
})

app.get('/api/config', (c) => {
  return handleConfig(new URL(c.req.url), { NSFW_SHOW: c.env.NSFW_SHOW })
})

// 图片代理
app.get('/image/*', (c) => {
  return handleImage({ BANGUMI_R2: c.env.BANGUMI_R2 }, c.req.raw)
})

// 管理页面
app.get('/manage', () => {
  return new Response(manageHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/manage/callback', () => {
  const html = '<html><body><script>window.opener.postMessage({code:new URLSearchParams(window.location.search).get("code")},"*");window.close();</script></body></html>'
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/api/manage/oauth-url', (c) => {
  const clientId = c.env.BANGUMI_CLIENT_ID || ''
  if (!clientId) return Response.json({ error: 'BANGUMI_CLIENT_ID not configured' }, { status: 500 })
  const redirectUri = `${new URL(c.req.url).origin}/manage/callback`
  const state = c.req.query('state') || ''
  return Response.json({ url: getOAuthRedirectUrl(clientId, redirectUri, state) })
})

app.get('/api/manage/exchange', async (c) => {
  const code = c.req.query('code') || ''
  try {
    const result = await exchangeCode(
      c.env.BANGUMI_CLIENT_ID || '',
      c.env.BANGUMI_CLIENT_SECRET || '',
      code,
      `${new URL(c.req.url).origin}/manage/callback`,
    )
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
})

app.post('/api/manage/compare', async (c) => {
  const body = await c.req.json()
  try {
    const result = await compareAccounts(body.tokenA || '', body.userA || '', body.tokenB || '', body.userB || '')
    return Response.json(result)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
})

app.post('/api/manage/sync', async (c) => {
  const body = await c.req.json()
  try {
    const results = await executeSync(body.tokenA, body.from, body.tokenB, body.to, {
      mode: body.mode,
      from: body.from,
      to: body.to,
      subject_ids: body.subject_ids,
    })
    return Response.json(results)
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
})

// HTTP 触发的手动同步（需要密钥）。
app.post('/__cron/sync', async (c) => {
  const secret = c.req.header('X-Cron-Secret')
  if (secret !== c.env.CRON_SECRET) return new Response('Unauthorized', { status: 401 })

  const storage = new KVStorage(c.env.BANGUMI_KV)
  const imageStore = new R2ImageStore(c.env.BANGUMI_R2)
  const users = c.env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)

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
    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error('Sync error:', err)
    return new Response('Sync failed', { status: 500 })
  }
})

/** Cloudflare Cron Triggers 入口：每 4 小时触发一次自动同步。 */
async function scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
  const storage = new KVStorage(env.BANGUMI_KV)
  const imageStore = new R2ImageStore(env.BANGUMI_R2)
  const users = env.BANGUMI_USERS.split(',').map((s) => s.trim()).filter(Boolean)
  ctx.waitUntil(
    runSync(storage, imageStore, {
      BANGUMI_TOKEN: env.BANGUMI_TOKEN,
      BANGUMI_REFRESH_TOKEN: env.BANGUMI_REFRESH_TOKEN,
      BANGUMI_CLIENT_ID: env.BANGUMI_CLIENT_ID,
      BANGUMI_CLIENT_SECRET: env.BANGUMI_CLIENT_SECRET,
      BANGUMI_USERS: users,
      BANGUMI_PRIMARY_USER: env.BANGUMI_PRIMARY_USER,
      SYNC_MODE: env.SYNC_MODE || 'merge',
    }).catch((err) => console.error('Scheduled sync error:', err)),
  )
}

export default {
  fetch: app.fetch,
  scheduled,
}
