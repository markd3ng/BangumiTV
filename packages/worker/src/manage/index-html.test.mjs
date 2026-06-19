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
  assert.match(html, /const popup = window\.open\(data\.url,\s*'bgm-oauth'/)
  assert.match(html, /pendingOAuth = \{\s*purpose,\s*state:\s*data\.state,\s*nonce:\s*data\.nonce,\s*popup\s*\}/)
})

test('oauth message handling binds origin popup and exact state', () => {
  assert.match(html, /window\.addEventListener\('message',\s*async\s*\(ev\)\s*=>/)
  assert.match(html, /ev\.origin !== location\.origin/)
  assert.match(html, /ev\.source !== pendingOAuth\.popup/)
  assert.match(html, /d\.state !== pendingOAuth\.state/)
})

test('oauth message handling cross-checks decoded state purpose and nonce', () => {
  assert.match(html, /parseStatePayload\(/)
  assert.match(html, /payload\.nonce !== pendingOAuth\.nonce/)
  assert.match(html, /payload\.purpose !== pendingOAuth\.purpose/)
})

test('manual callback requires same origin and matching pending state', () => {
  assert.match(html, /new URL\(rawUrl\)/)
  assert.match(html, /url\.origin !== location\.origin/)
  assert.match(html, /url\.searchParams\.get\('state'\) !== pendingOAuth\.state/)
  assert.match(html, /await exchangeOAuth\(code,\s*pendingOAuth\.state,\s*pendingOAuth\.purpose\)/)
})

test('cron success depends on ok true and account flows only accept access_token', () => {
  assert.match(html, /data\.ok === true/)
  assert.match(html, /if \(!data\.access_token\)/)
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
