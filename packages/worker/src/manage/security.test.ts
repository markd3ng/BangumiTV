import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import {
  authorizeManageRequest,
  callbackPageCsp,
  createOAuthState,
  createHealthFailureLog,
  createManageErrorLog,
  manageHeaders,
  managePageCsp,
  oauthCallbackHtml,
  publicError,
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

function namedError(name: string, message: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { name }, extra)
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

test('public errors never echo upstream text', async () => {
  const response = publicError(502, 'BGM_UPSTREAM', new Error('access_token=secret upstream body'))
  const body = await response.text()
  assert.deepEqual(JSON.parse(body), {
    error: { code: 'BGM_UPSTREAM', message: 'Upstream request failed' },
  })
  assert.doesNotMatch(body, /secret|upstream body/)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
})

test('manage error logs keep only safe structured fields', () => {
  const authLog = createManageErrorLog(
    '/api/manage/exchange',
    namedError('BgmHttpError', 'access_token=secret upstream body', { status: 403 }),
    '2026-06-19T00:00:00.000Z',
  )
  assert.deepEqual(authLog, {
    event: 'manage_request_failed',
    route: '/api/manage/exchange',
    kind: 'BgmHttpError',
    upstream_status: 403,
    at: '2026-06-19T00:00:00.000Z',
  })

  const timeoutLog = createManageErrorLog(
    '/api/manage/sync',
    namedError('BgmTimeoutError', 'code=oauth-secret'),
    '2026-06-19T00:00:00.000Z',
  )
  assert.deepEqual(timeoutLog, {
    event: 'manage_request_failed',
    route: '/api/manage/sync',
    kind: 'BgmTimeoutError',
    upstream_status: undefined,
    at: '2026-06-19T00:00:00.000Z',
  })

  const networkLog = createManageErrorLog(
    '/api/manage/compare',
    namedError('BgmNetworkError', 'state=stolen'),
    '2026-06-19T00:00:00.000Z',
  )
  assert.deepEqual(networkLog, {
    event: 'manage_request_failed',
    route: '/api/manage/compare',
    kind: 'BgmNetworkError',
    upstream_status: undefined,
    at: '2026-06-19T00:00:00.000Z',
  })

  assert.deepEqual(Object.keys(networkLog).sort(), ['at', 'event', 'kind', 'route', 'upstream_status'])
  assert.doesNotMatch(JSON.stringify(networkLog), /message|state|code|token|secret/i)
})

test('health failure logs keep only safe structured fields', () => {
  const log = createHealthFailureLog(new Error('username=ian sync:last_error=oops'), '2026-06-19T00:00:00.000Z')
  assert.deepEqual(log, {
    event: 'health_failed',
    kind: 'Error',
    at: '2026-06-19T00:00:00.000Z',
  })
  assert.doesNotMatch(JSON.stringify(log), /message|request|state|code|token|username|last_error/i)
})

test('management and callback CSP stay compatible with current inline assets', () => {
  assert.equal(
    managePageCsp(),
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  )
  assert.equal(
    callbackPageCsp(),
    "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  )
})

test('worker source isolates public CORS and removes public manage gate', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')

  assert.ok(source.includes("const publicCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] })"))
  for (const route of ['/api/collections', '/api/calendar', '/api/config', '/api/health']) {
    assert.ok(source.includes(`app.use('${route}', publicCors)`), `expected public CORS on ${route}`)
  }

  assert.equal(source.includes("app.use('*', cors("), false)
  assert.equal(source.includes('/api/manage/gate'), false)
  assert.equal(source.includes('requireManageSecret'), false)
  assert.ok(source.includes("app.use('/api/manage/*', async (c, next) => {"))

  const middlewareIndex = source.indexOf("app.use('/api/manage/*', async (c, next) => {")
  const manageRouteIndexes = [
    source.indexOf("app.get('/api/manage/oauth-url'"),
    source.indexOf("app.get('/api/manage/exchange'"),
    source.indexOf("app.post('/api/manage/compare'"),
    source.indexOf("app.post('/api/manage/sync'"),
    source.indexOf("app.delete('/api/manage/cron-token'"),
  ]
  for (const index of manageRouteIndexes) {
    assert.ok(index > middlewareIndex, 'expected manage middleware before management handlers')
  }
})

test('worker source keeps health endpoint free of sync:last_error and usernames', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const healthBlockMatch = source.match(/app\.get\('\/api\/health', async \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(healthBlockMatch, 'expected health handler source block')
  const healthBlock = healthBlockMatch[0]

  assert.equal(healthBlock.includes('sync:last_error'), false)
  assert.equal(healthBlock.includes('users:'), false)
  assert.equal(healthBlock.includes('last_error:'), false)
  assert.match(healthBlock, /console\.error\(JSON\.stringify\(createHealthFailureLog\(err\)\)\)/)
  assert.match(healthBlock, /return Response\.json\(\{ ok: false \}/)
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
