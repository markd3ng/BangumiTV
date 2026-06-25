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

test('token inputs for A and B are present', () => {
  assert.ok(html.includes('id="tokenA"'), 'account A token input')
  assert.ok(html.includes('id="tokenB"'), 'account B token input')
})

test('token inputs are marked as requiring management secret', () => {
  for (const id of ['tokenA', 'tokenB', 'start-compare']) {
    assert.ok(html.includes(`id="${id}"`) && html.includes('data-requires-secret'), `${id} requires secret`)
  }
})

test('sync copy states that only anime collections are synced', () => {
  assert.ok(html.includes('仅同步动画收藏'), 'manage page states anime-only sync scope')
})

test('compare flow uses manual tokens, not OAuth', () => {
  assert.ok(script.includes('tokenA: ta, userA:'), 'compare body includes Account tokens')
  assert.ok(script.includes('/api/manage/compare'), 'calls compare endpoint')
  assert.ok(script.includes("state.tokenA = ta"), 'stores tokenA from input')
  assert.ok(script.includes("state.tokenB = tb"), 'stores tokenB from input')
  assert.ok(!script.includes("state.userA"), 'no username state variables')
})

test('sync flow passes tokens from state', () => {
  assert.ok(script.includes("tokenA: fromToken, from: fromUser, tokenB: toToken, to: toUser"), 'sync body includes tokens')
  assert.ok(script.includes('/api/manage/sync'), 'calls sync endpoint')
})

test('no password gate or persistent secret storage', () => {
  assert.ok(!html.includes('id="gate"'), 'no password gate HTML')
  assert.ok(!script.includes("gate-input"), 'no gate input JS')
  assert.ok(!script.includes('manageSecret'), 'no manageSecret variable')
  assert.ok(!script.includes('X-Manage-Secret'), 'no auth header injection')
})

test('interactive controls use event listeners and textContent', () => {
  assert.ok(script.includes('addEventListener'), 'uses addEventListener')
  assert.ok(script.includes('textContent'), 'uses textContent (no innerHTML for user data)')
})

test('cron delete endpoint still available', async () => {
  const workerSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
  assert.ok(workerSource.includes("delete('/api/manage/cron-token'"), 'DELETE endpoint exists')
})
