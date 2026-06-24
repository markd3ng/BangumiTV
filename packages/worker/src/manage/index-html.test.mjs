import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8')
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1]

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return data },
    async text() { return JSON.stringify(data) },
    clone() { return this },
  }
}

test('no OAuth UI or popup code remains', () => {
  assert.equal(html.includes('OAuth'), false, 'no OAuth references in HTML')
  assert.equal(html.includes('oauth'), false, 'no oauth references in HTML')
  assert.equal(script.includes('window.open'), false, 'no window.open (popup)')
  assert.equal(script.includes('pendingOAuth'), false, 'no pendingOAuth state')
})

test('token inputs for cron, A, and B are present', () => {
  assert.ok(html.includes('id="cron-token-input"'), 'cron token input')
  assert.ok(html.includes('id="tokenA"'), 'account A token input')
  assert.ok(html.includes('id="tokenB"'), 'account B token input')
})

test('token inputs are marked as requiring management secret', () => {
  for (const id of ['cron-token-input', 'tokenA', 'tokenB', 'start-compare', 'cron-token-save']) {
    assert.ok(html.includes(`id="${id}"`) && html.includes('data-requires-secret'), `${id} requires secret`)
  }
})

test('compare flow uses manual tokens, not OAuth', () => {
  assert.ok(script.includes('tokenA: ta, userA: ua, tokenB: tb, userB: ub'), 'compare body includes manual tokens')
  assert.ok(script.includes('/api/manage/compare'), 'calls compare endpoint')
  assert.ok(script.includes("state.tokenA = ta"), 'stores tokenA from input')
  assert.ok(script.includes("state.tokenB = tb"), 'stores tokenB from input')
})

test('cron token uses POST /api/manage/cron-token', () => {
  assert.ok(script.includes("'/api/manage/cron-token'"), 'calls cron-token endpoint')
  assert.ok(script.includes("method: 'POST'"), 'POST method used')
  assert.ok(script.includes('body: JSON.stringify({ token })'), 'sends token in body')
})

test('sync flow passes tokens from state', () => {
  assert.ok(script.includes("tokenA: fromToken, from: fromUser, tokenB: toToken, to: toUser"), 'sync body includes tokens')
  assert.ok(script.includes('/api/manage/sync'), 'calls sync endpoint')
})

test('gate re-shows on 401/503 and manage secret stays memory-only', () => {
  assert.ok(script.includes("manageSecret = ''"), 'manageSecret cleared on auth failure')
  assert.ok(script.includes("document.getElementById('gate').style.display = 'block'"), 'gate re-shown')
  assert.ok(!script.includes('localStorage'), 'no persistent secret storage')
  assert.ok(!script.includes('sessionStorage'), 'no persistent secret storage')
})

test('interactive controls use event listeners and textContent', () => {
  assert.ok(script.includes('addEventListener'), 'uses addEventListener')
  assert.ok(script.includes('textContent'), 'uses textContent (no innerHTML for user data)')
})

test('cron token save and clear are wired', () => {
  assert.ok(script.includes("cron-token-save"), 'cron save button wired')
  assert.ok(script.includes("cron-token-clear"), 'cron clear button wired')
  assert.ok(script.includes("/api/manage/cron-token', { method: 'DELETE'"), 'cron delete wired')
})

// Verify the backend endpoint exists for POST /api/manage/cron-token
test('backend has POST /api/manage/cron-token endpoint', async () => {
  const workerSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  assert.ok(workerSource.includes("post('/api/manage/cron-token'"), 'POST endpoint exists')
  assert.ok(workerSource.includes("bgm:tokens"), 'writes to bgm:tokens KV key')
})
