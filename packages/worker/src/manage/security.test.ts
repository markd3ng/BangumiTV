import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'
import {
  authorizeManageRequest,
  createOAuthState,
  manageHeaders,
  oauthCallbackHtml,
  verifyOAuthState,
} from './security.ts'

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

async function signState(secret: string, payload: unknown): Promise<string> {
  const material = await digest(`bangumi-tv:oauth-state:v1\0${secret}`)
  const key = await crypto.subtle.importKey(
    'raw',
    material,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const encodedPayload = base64url(encoder.encode(JSON.stringify(payload)))
  const signature = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(encodedPayload)),
  )
  return `${encodedPayload}.${base64url(signature)}`
}

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

test('signed state rejects payload with invalid version even when signature is valid', async () => {
  const now = Date.UTC(2026, 5, 19)
  const state = await signState('secret', {
    v: 2,
    nonce: 'abcdefghijklmnopQRSTUV',
    purpose: 'account-a',
    exp: Math.floor(now / 1000) + 300,
  })
  assert.equal(await verifyOAuthState('secret', state, now), null)
})

test('signed state rejects payload with invalid nonce even when signature is valid', async () => {
  const now = Date.UTC(2026, 5, 19)
  const state = await signState('secret', {
    v: 1,
    nonce: 'bad-nonce',
    purpose: 'account-a',
    exp: Math.floor(now / 1000) + 300,
  })
  assert.equal(await verifyOAuthState('secret', state, now), null)
})

test('signed state rejects payload with invalid purpose even when signature is valid', async () => {
  const now = Date.UTC(2026, 5, 19)
  const state = await signState('secret', {
    v: 1,
    nonce: 'abcdefghijklmnopQRSTUV',
    purpose: 'admin',
    exp: Math.floor(now / 1000) + 300,
  })
  assert.equal(await verifyOAuthState('secret', state, now), null)
})

test('signed state rejects payload with non-integer expiry even when signature is valid', async () => {
  const now = Date.UTC(2026, 5, 19)
  const state = await signState('secret', {
    v: 1,
    nonce: 'abcdefghijklmnopQRSTUV',
    purpose: 'account-a',
    exp: '1760000000',
  })
  assert.equal(await verifyOAuthState('secret', state, now), null)
})

test('management headers disable storage and framing', () => {
  const headers = new Headers(manageHeaders())
  assert.equal(headers.get('Cache-Control'), 'no-store')
  assert.equal(headers.get('X-Frame-Options'), 'DENY')
  assert.equal(headers.get('X-Content-Type-Options'), 'nosniff')
  assert.equal(headers.get('Referrer-Policy'), 'no-referrer')
})

test('callback reads code and state from query, posts to current origin, and closes window', () => {
  const html = oauthCallbackHtml()
  assert.match(html, /location\.origin/)
  assert.doesNotMatch(html, /postMessage\([^)]*,\s*["']\*["']/)

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(scriptMatch, 'expected callback html to contain inline script')

  const calls: Array<{ message: unknown; targetOrigin: unknown }> = []
  let closed = false

  vm.runInNewContext(scriptMatch[1], {
    URLSearchParams,
    location: {
      search: '?code=test-code&state=test-state',
      origin: 'https://worker.example',
    },
    window: {
      opener: {
        postMessage(message: unknown, targetOrigin: unknown) {
          calls.push({ message, targetOrigin })
        },
      },
      close() {
        closed = true
      },
    },
  })

  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0]?.message)), {
    type: 'bgm-oauth',
    code: 'test-code',
    state: 'test-state',
  })
  assert.equal(calls[0]?.targetOrigin, 'https://worker.example')
  assert.equal(closed, true)
})
