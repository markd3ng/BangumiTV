import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorizeManageRequest,
  createOAuthState,
  manageHeaders,
  oauthCallbackHtml,
  verifyOAuthState,
} from './security.ts'

test('management auth denies missing configuration and bad credentials', async () => {
  const request = new Request('https://worker.example/api/manage/compare')
  assert.equal((await authorizeManageRequest(request, undefined))?.status, 503)
  assert.equal((await authorizeManageRequest(request, 'secret'))?.status, 401)
  assert.equal(
    (await authorizeManageRequest(
      new Request(request.url, { headers: { 'X-Manage-Secret': 'wrong' } }),
      'secret',
    ))?.status,
    401,
  )
  assert.equal(
    await authorizeManageRequest(
      new Request(request.url, { headers: { 'X-Manage-Secret': 'secret' } }),
      'secret',
    ),
    null,
  )
})

test('management auth rejects a third-party browser origin', async () => {
  const response = await authorizeManageRequest(
    new Request('https://worker.example/api/manage/compare', {
      headers: { Origin: 'https://evil.example', 'X-Manage-Secret': 'secret' },
    }),
    'secret',
  )
  assert.equal(response?.status, 403)
  assert.equal(response?.headers.get('Access-Control-Allow-Origin'), null)

  const wrongSecretResponse = await authorizeManageRequest(
    new Request('https://worker.example/api/manage/compare', {
      headers: { Origin: 'https://evil.example', 'X-Manage-Secret': 'wrong' },
    }),
    'secret',
  )
  assert.equal(wrongSecretResponse?.status, 403)
})

test('signed state validates and rejects tampering, expiry, and wrong purpose data', async () => {
  const now = Date.UTC(2026, 5, 19)
  const created = await createOAuthState('secret', 'account-a', now)
  assert.equal((await verifyOAuthState('secret', created.state, now))?.nonce, created.nonce)
  assert.equal(await verifyOAuthState('wrong-secret', created.state, now), null)
  assert.equal(await verifyOAuthState('secret', created.state + 'x', now), null)
  assert.equal(await verifyOAuthState('secret', created.state, now + 301_000), null)
  assert.equal(await verifyOAuthState('secret', 'x'.repeat(1025), now), null)
})

test('management headers disable storage and framing', () => {
  const headers = new Headers(manageHeaders())
  assert.equal(headers.get('Cache-Control'), 'no-store')
  assert.equal(headers.get('X-Frame-Options'), 'DENY')
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer')
})

test('callback posts only to the current origin', () => {
  const html = oauthCallbackHtml()
  assert.match(html, /location\.origin/)
  assert.doesNotMatch(html, /postMessage\([^)]*,\s*["']\*["']/)
})
