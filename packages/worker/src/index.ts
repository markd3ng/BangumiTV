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
import { getOAuthRedirectUrl, exchangeCode } from './manage/oauth'
import { handleImage } from './image/proxy'
import manageHtml from './manage/index.html'
import { INDEX_HTML, BANGUMI_JS, BANGUMI_CSS } from './assets'
import { BgmHttpError, BgmTimeoutError, BgmNetworkError } from '@bangumi-tv/shared'

function errorToResponse(err: unknown): Response {
  if (err instanceof BgmHttpError) {
    const status = err.status === 401 || err.status === 403 ? 401 : 502
    return Response.json({
      error: { code: 'BGM_HTTP_ERROR', message: err.message, status: err.status }
    }, { status })
  }
  if (err instanceof BgmTimeoutError) {
    return Response.json({
      error: { code: 'BGM_TIMEOUT', message: err.message }
    }, { status: 504 })
  }
  if (err instanceof BgmNetworkError) {
    return Response.json({
      error: { code: 'BGM_NETWORK', message: err.message }
    }, { status: 502 })
  }
  return Response.json({
    error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) }
  }, { status: 500 })
}

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
  MANAGE_SECRET?: string
}

const app = new Hono<{ Bindings: Env }>()

// CORS：使用 hono/cors 中间件，确保头会落到真实响应上（含 OPTIONS 预检）。
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'X-Manage-Secret'],
}))

// 主页：apiUrl 由前端自动取 window.location.origin，无需硬编码域名。
app.get('/', () => {
  return new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

// 静态资源（Worker 提供主页引用的 JS/CSS，避免跨域到 Pages）。
app.get('/src/bangumi.js', () => {
  return new Response(BANGUMI_JS, { headers: { 'Content-Type': 'application/javascript; charset=utf-8' } })
})
app.get('/src/bangumi.css', () => {
  return new Response(BANGUMI_CSS, { headers: { 'Content-Type': 'text/css; charset=utf-8' } })
})

// 公开 API
app.get('/api/collections', (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCollections(storage, new URL(c.req.url), c.env.NSFW_SHOW !== 'false')
})

app.get('/api/calendar', (c) => {
  const storage = new KVStorage(c.env.BANGUMI_KV)
  return handleCalendar(storage, c.env.NSFW_SHOW !== 'false')
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
  // 把 code 与 state 回传给打开它的 /manage 父窗口，再自动关闭。
  const html = '<html><body><script>' +
    'var p=new URLSearchParams(location.search);' +
    'try{window.opener.postMessage({type:"bgm-oauth",code:p.get("code"),state:p.get("state")},"*");}catch(e){}' +
    'window.close();' +
    '</script>' +
    '<noscript>请复制本页地址栏完整 URL，粘贴回管理页面。</noscript>' +
    '</body></html>'
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/api/manage/oauth-url', (c) => {
  const clientId = c.env.BANGUMI_CLIENT_ID || ''
  if (!clientId) return Response.json({ error: 'BANGUMI_CLIENT_ID not configured' }, { status: 500 })
  const redirectUri = `${new URL(c.req.url).origin}/manage/callback`
  const state = c.req.query('state') || ''
  return Response.json({ url: getOAuthRedirectUrl(clientId, redirectUri, state) })
})

// 管理写操作鉴权：若设置了 MANAGE_SECRET，则所有 /api/manage/* 写端点
// （exchange/compare/sync/cron-token）必须带匹配的 X-Manage-Secret 头。
// oauth-url 仅构造跳转 URL、不接触敏感数据，故不强制。
function requireManageSecret(c: { env: Env; req: { header(n: string): string | undefined } }): Response | null {
  if (!c.env.MANAGE_SECRET) return null // 未配置则放行（向后兼容）
  const provided = c.req.header('X-Manage-Secret')
  if (provided && provided === c.env.MANAGE_SECRET) return null
  return Response.json({ error: 'Unauthorized' }, { status: 401 })
}

app.get('/api/manage/exchange', async (c) => {
  const gate = requireManageSecret(c)
  if (gate) return gate
  const code = c.req.query('code') || ''
  const persistCron = c.req.query('cron') === '1'
  try {
    const result = await exchangeCode(
      c.env.BANGUMI_CLIENT_ID || '',
      c.env.BANGUMI_CLIENT_SECRET || '',
      code,
      `${new URL(c.req.url).origin}/manage/callback`,
    )
    // 授权为 cron 同步用：把 token 对持久化进 KV，cron 自动复用与续期，
    // 无需在 GitHub 配置 BANGUMI_TOKEN/BANGUMI_REFRESH_TOKEN。
    if (persistCron) {
      const storage = new KVStorage(c.env.BANGUMI_KV)
      await storage.put('bgm:tokens', {
        access_token: result.access_token,
        refresh_token: result.refresh_token,
      })
    }
    return Response.json(result)
  } catch (err) {
    return errorToResponse(err)
  }
})

app.post('/api/manage/compare', async (c) => {
  const gate = requireManageSecret(c)
  if (gate) return gate
  const body = await c.req.json()
  try {
    const result = await compareAccounts(body.tokenA || '', body.userA || '', body.tokenB || '', body.userB || '')
    return Response.json(result)
  } catch (err) {
    return errorToResponse(err)
  }
})

app.post('/api/manage/sync', async (c) => {
  const gate = requireManageSecret(c)
  if (gate) return gate
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
    return errorToResponse(err)
  }
})

// 清除 KV 中持久化的 cron token（重新授权前调用）。
app.delete('/api/manage/cron-token', async (c) => {
  const gate = requireManageSecret(c)
  if (gate) return gate
  const storage = new KVStorage(c.env.BANGUMI_KV)
  await storage.delete('bgm:tokens')
  return Response.json({ ok: true })
})

// 非破坏性探测：管理页是否启用了 MANAGE_SECRET 密码保护。
app.get('/api/manage/gate', (c) => {
  return Response.json({ gated: !!c.env.MANAGE_SECRET })
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
