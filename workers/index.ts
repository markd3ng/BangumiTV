import { Hono } from 'hono'
import { KVStorage } from '../src/storage/kv'
import { handleCollections } from '../src/api/collections'
import { handleCalendar } from '../src/api/calendar'
import { handleConfig } from '../src/api/config'
import { runSync } from '../src/sync/cron'
import { compareAccounts } from '../src/manage/compare'
import { executeSync } from '../src/manage/sync-write'

// 管理页面 — HTML 模板字符串内联
const manageHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BangumiTV - 多账户同步</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #1a1a2e; color: #e0e0e0; min-height: 100vh; display: flex; justify-content: center; padding: 40px 20px; }
    .container { max-width: 800px; width: 100%; }
    h1 { text-align: center; margin-bottom: 32px; color: #fff; }
    .step { background: #16213e; border-radius: 12px; padding: 24px; margin-bottom: 16px; display: none; }
    .step.active { display: block; }
    label { display: block; margin-bottom: 8px; color: #a0a0b0; }
    input[type="text"] { width: 100%; padding: 12px; border: 1px solid #2a2a4a; border-radius: 8px; background: #0f3460; color: #fff; font-size: 16px; margin-bottom: 16px; }
    input[type="text"]:focus { outline: none; border-color: #e94560; }
    button { padding: 12px 24px; border: none; border-radius: 8px; font-size: 16px; cursor: pointer; background: #e94560; color: #fff; margin-right: 8px; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.secondary { background: #0f3460; }
    .diff-item { display: flex; align-items: center; gap: 12px; padding: 12px; border-bottom: 1px solid #2a2a4a; }
    .diff-item img { width: 60px; height: 85px; object-fit: cover; border-radius: 4px; }
    .diff-info { flex: 1; }
    .diff-info h3 { font-size: 14px; margin-bottom: 4px; }
    .diff-info p { font-size: 12px; color: #a0a0b0; }
    .progress { margin-top: 16px; }
    .progress-bar { height: 8px; background: #2a2a4a; border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; background: #e94560; transition: width 0.3s; }
    select { padding: 8px 12px; border-radius: 6px; background: #0f3460; color: #fff; border: 1px solid #2a2a4a; }
    .summary { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
    .summary-card { background: #0f3460; border-radius: 8px; padding: 16px; text-align: center; }
    .summary-card .count { font-size: 28px; font-weight: bold; color: #e94560; }
    .summary-card .label { font-size: 12px; color: #a0a0b0; margin-top: 4px; }
  </style>
</head>
<body>
<div class="container">
  <h1>BangumiTV 多账户同步</h1>
  <div class="step active" id="step1">
    <h2>步骤 1: 输入 bgm.tv 用户名</h2>
    <label>账号 A</label>
    <input type="text" id="userA" placeholder="输入 bgm.tv 用户名">
    <label>账号 B</label>
    <input type="text" id="userB" placeholder="输入 bgm.tv 用户名">
    <button onclick="startOAuth()">下一步：OAuth 授权</button>
  </div>
  <div class="step" id="step2">
    <h2>步骤 2: OAuth 授权</h2>
    <p id="oauth-status">等待授权...</p>
    <div id="oauth-buttons"></div>
  </div>
  <div class="step" id="step3">
    <h2>步骤 3: 选择同步模式</h2>
    <div class="summary" id="step3-summary"></div>
    <div style="margin-bottom:20px">
      <label>同步方向</label>
      <select id="sync-direction">
        <option value="A->B">A → B</option>
        <option value="B->A">B → A</option>
      </select>
    </div>
    <button onclick="startFullSync()">完整同步（所有条目）</button>
    <button onclick="showPartialSync()">部分同步（选择条目）</button>
    <div id="partial-list" style="display:none; margin-top:16px;">
      <label><input type="checkbox" id="select-all" onchange="toggleAll(this)"> 全选</label>
      <div id="diff-list"></div>
      <button onclick="startPartialSync()" style="margin-top:16px;">同步选中条目</button>
    </div>
  </div>
  <div class="step" id="step4">
    <h2>步骤 4: 同步中...</h2>
    <div class="progress"><div class="progress-bar"><div class="progress-fill" id="progress-fill" style="width:0%"></div></div><p id="progress-text" style="margin-top:8px;">准备中...</p></div>
    <div id="sync-results" style="margin-top:16px;"></div>
    <button onclick="location.reload()" style="margin-top:16px;">返回</button>
  </div>
</div>
<script>
let state = { userA: '', userB: '', tokenA: '', tokenB: '', differences: [] }
function showStep(n) { document.querySelectorAll('.step').forEach(s => s.classList.remove('active')); document.getElementById('step'+n).classList.add('active') }
async function startOAuth() {
  state.userA = document.getElementById('userA').value.trim(); state.userB = document.getElementById('userB').value.trim()
  if (!state.userA || !state.userB) return alert('请输入两个用户名')
  showStep(2)
  document.getElementById('oauth-status').textContent = '正在为 ' + state.userA + ' 发起授权...'
  const res = await fetch('/api/manage/oauth-url?user=' + encodeURIComponent(state.userA) + '&state=A')
  const { url } = await res.json()
  if (!url) return alert('OAuth URL 获取失败')
  window.open(url, '_blank')
  document.getElementById('oauth-status').textContent = '请在弹出窗口中完成 ' + state.userA + ' 的授权，然后将回调 URL 粘贴到下方：'
  document.getElementById('oauth-buttons').innerHTML = '<input type="text" id="callbackA" placeholder="粘贴回调 URL"><button onclick="submitCallback(\'A\')">确认</button>'
}
async function submitCallback(which) {
  const url = document.getElementById('callback'+which).value.trim()
  const code = new URL(url).searchParams.get('code')
  if (!code) return alert('无效的回调 URL')
  const user = which === 'A' ? state.userA : state.userB
  const res = await fetch('/api/manage/exchange?code=' + encodeURIComponent(code) + '&user=' + encodeURIComponent(user))
  const data = await res.json()
  if (!data.access_token) return alert('授权失败')
  if (which === 'A') {
    state.tokenA = data.access_token
    document.getElementById('oauth-status').textContent = '正在为 ' + state.userB + ' 发起授权...'
    const res2 = await fetch('/api/manage/oauth-url?user=' + encodeURIComponent(state.userB) + '&state=B')
    const { url: urlB } = await res2.json()
    if (!urlB) return alert('OAuth URL 获取失败')
    window.open(urlB, '_blank')
    document.getElementById('oauth-buttons').innerHTML = '<input type="text" id="callbackB" placeholder="粘贴回调 URL"><button onclick="submitCallback(\'B\')">确认</button>'
  } else { state.tokenB = data.access_token; loadComparison() }
}
async function loadComparison() {
  showStep(3)
  const res = await fetch('/api/manage/compare?tokenA=' + encodeURIComponent(state.tokenA) + '&tokenB=' + encodeURIComponent(state.tokenB) + '&userA=' + state.userA + '&userB=' + state.userB)
  const data = await res.json()
  document.getElementById('step3-summary').innerHTML = '<div class="summary-card"><div class="count">'+(data.userA?.total||0)+'</div><div class="label">'+state.userA+'</div></div><div class="summary-card"><div class="count">'+(data.userB?.total||0)+'</div><div class="label">'+state.userB+'</div></div>'
  state.differences = data.differences || []
}
async function doSync(mode, subjectIds) {
  showStep(4)
  const dir = document.getElementById('sync-direction').value
  const from = dir === 'A->B' ? state.userA : state.userB
  const to = dir === 'A->B' ? state.userB : state.userA
  const fromToken = dir === 'A->B' ? state.tokenA : state.tokenB
  const toToken = dir === 'A->B' ? state.tokenB : state.tokenA
  const res = await fetch('/api/manage/sync', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({mode,from,to,tokenA:fromToken,tokenB:toToken,subject_ids:subjectIds||[]}) })
  const results = await res.json()
  const arr = Array.isArray(results) ? results : []
  const ok = arr.filter(r => r.status === 'ok').length
  document.getElementById('progress-fill').style.width = '100%'
  document.getElementById('progress-text').textContent = '完成: ' + ok + '/' + arr.length
  document.getElementById('sync-results').innerHTML = arr.map(r => '<div class="diff-item"><span style="margin-right:12px">'+(r.status==='ok'?'✓':'✗')+'</span><span>'+r.name+'</span></div>').join('')
}
function startFullSync() { doSync('full', []) }
function startPartialSync() {
  const checks = document.querySelectorAll('#diff-list input[type=checkbox]:checked')
  const ids = [...checks].map(c => parseInt(c.value))
  if (ids.length === 0) return alert('请至少选择一个条目')
  doSync('partial', ids)
}
function showPartialSync() {
  document.getElementById('partial-list').style.display = 'block'
  document.getElementById('diff-list').innerHTML = (state.differences||[]).map(d => '<div class="diff-item"><input type="checkbox" value="'+d.subject_id+'"><div class="diff-info"><h3>'+(d.name_cn||d.name)+'</h3><p>A: '+d.epStatusA+'ep | B: '+d.epStatusB+'ep</p></div></div>').join('')
}
function toggleAll(el) { document.querySelectorAll('#diff-list input[type=checkbox]').forEach(c => c.checked = el.checked) }
</script>
</body>
</html>`

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

// 管理页面
app.get('/manage', () => {
  return new Response(manageHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/manage/callback', () => {
  const html = '<html><body><script>window.opener.postMessage({code:new URLSearchParams(window.location.search).get("code")},"*");window.close();</script></body></html>'
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
})

app.get('/api/manage/oauth-url', (c) => {
  const user = c.req.query('user') || ''
  const clientId = c.env.BANGUMI_CLIENT_ID || ''
  const redirectUri = `${new URL(c.req.url).origin}/manage/callback`
  const state = c.req.query('state') || ''
  if (!clientId) return Response.json({ error: 'BANGUMI_CLIENT_ID not configured' }, { status: 500 })
  const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: redirectUri, state, scope: '' })
  return Response.json({ url: `https://bgm.tv/oauth/authorize?${params.toString()}` })
})

app.get('/api/manage/exchange', async (c) => {
  const code = c.req.query('code') || ''
  const { exchangeCode } = await import('../src/manage/oauth')
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

app.get('/api/manage/compare', async (c) => {
  const url = new URL(c.req.url)
  const tokenA = url.searchParams.get('tokenA') || ''
  const tokenB = url.searchParams.get('tokenB') || ''
  const userA = url.searchParams.get('userA') || ''
  const userB = url.searchParams.get('userB') || ''
  try {
    const result = await compareAccounts(tokenA, userA, tokenB, userB)
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

export default app
