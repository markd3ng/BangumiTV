import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')

test('management credentials stay memory-only', () => {
  assert.doesNotMatch(html, /sessionStorage|localStorage/)
  assert.match(html, /let manageSecret = ''/)
  assert.match(html, /let pendingOAuth = null/)
  assert.match(html, /tokenA:\s*''/)
  assert.match(html, /tokenB:\s*''/)
})

test('public page does not probe gate state or prompt for secrets', () => {
  assert.doesNotMatch(html, /\/api\/manage\/gate/)
  assert.doesNotMatch(html, /\bprompt\s*\(/)
  assert.doesNotMatch(html, /_retried/)
})

test('gate handling only re-shows password UI for 401 and 503', () => {
  assert.match(html, /response\.status === 401 \|\| response\.status === 503/)
  assert.match(html, /document\.getElementById\('gate'\)\.style\.display = 'block'/)
})

test('oauth url creation uses json post with purpose body', () => {
  assert.match(html, /apiFetch\('\/api\/manage\/oauth-url',\s*\{/)
  assert.match(html, /method:\s*'POST'/)
  assert.match(html, /'Content-Type': 'application\/json'/)
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*purpose\s*\}\)/)
  assert.doesNotMatch(html, /\/api\/manage\/oauth-url\?/)
})

test('oauth exchange uses json post and never query params', () => {
  assert.match(html, /apiFetch\('\/api\/manage\/exchange',\s*\{/)
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*code,\s*state\s*:\s*signedState\s*\}\)/)
  assert.doesNotMatch(html, /\/api\/manage\/exchange\?/)
})

test('pending oauth keeps popup state nonce and purpose together', () => {
  assert.match(html, /const flow = \{\s*purpose,\s*state:\s*data\.state,\s*nonce:\s*data\.nonce,\s*popup:\s*null,\s*consuming:\s*false\s*\}/)
  assert.match(html, /pendingOAuth = flow/)
  assert.match(html, /const popup = window\.open\(data\.url,\s*'bgm-oauth'/)
})

test('oauth message handling binds origin popup and exact state', () => {
  assert.match(html, /window\.addEventListener\('message',\s*async\s*\(ev\)\s*=>/)
  assert.match(html, /ev\.origin !== location\.origin/)
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /ev\.source !== flow\.popup/)
  assert.match(html, /d\.state !== flow\.state/)
})

test('oauth message handling cross-checks decoded state purpose and nonce', () => {
  assert.match(html, /parseStatePayload\(/)
  assert.match(html, /payload\.nonce !== flow\.nonce/)
  assert.match(html, /payload\.purpose !== flow\.purpose/)
})

test('oauth exchange is single-flight and stale cleanup cannot clear a newer flow', () => {
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /if \(flow\.consuming\) return/)
  assert.match(html, /flow\.consuming = true/)
  assert.match(html, /if \(pendingOAuth === flow\) \{\s*resetPendingOAuth\(\)\s*\}/s)
})

test('manual callback requires same origin and matching pending state', () => {
  assert.match(html, /new URL\(rawUrl\)/)
  assert.match(html, /url\.origin !== location\.origin/)
  assert.match(html, /const flow = pendingOAuth/)
  assert.match(html, /url\.searchParams\.get\('state'\) !== flow\.state/)
  assert.match(html, /return consumeOAuthFlow\(flow,\s*code,\s*flow\.state\)/)
})

test('beginOAuth closes stale popup and clears pending state before opening a new one', () => {
  assert.match(html, /closePendingPopup\(\)/)
  assert.match(html, /resetPendingOAuth\(\)/)
  assert.match(html, /if \(!popup\) \{\s*resetPendingOAuth\(\)/s)
  assert.match(html, /授权弹窗打开失败，请稍后重试/)
  assert.doesNotMatch(html, /浏览器拦截/)
})

test('auth failures always show the same management password message', () => {
  assert.match(html, /管理验证失败，请重新输入密码/)
  assert.match(html, /response\.status === 401 \|\| response\.status === 503/)
})

test('cron success depends on ok true and account flows only accept access_token', () => {
  assert.match(html, /data\.ok === true/)
  assert.match(html, /if \(!data\.access_token\)/)
})

test('manual oauth controls are marked as requiring the management secret', () => {
  assert.match(html, /input\.setAttribute\('data-requires-secret', 'true'\)/)
  assert.match(html, /button\.setAttribute\('data-requires-secret', 'true'\)/)
})

test('dynamic data rendering uses dom text apis and no innerHTML', () => {
  assert.doesNotMatch(html, /\.innerHTML\s*=/)
  assert.match(html, /createElement/)
  assert.match(html, /textContent/)
  assert.match(html, /replaceChildren/)
  assert.match(html, /addEventListener/)
})

test('interactive controls are wired with event listeners instead of inline handlers', () => {
  assert.doesNotMatch(html, /\sonclick=/)
  assert.doesNotMatch(html, /\sonchange=/)
})
