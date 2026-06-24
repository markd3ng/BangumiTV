import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'
import * as security from './security.ts'
import {
  authorizeManageRequest,
  callbackPageCsp,
  createOAuthState,
  createHealthFailureLog,
  createManageErrorLog,
  createSyncFailureLog,
  manageHeaders,
  managePageCsp,
  oauthCallbackHtml,
  type OAuthPurpose,
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
    material.buffer as ArrayBuffer,
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

test('signed state rejects an expiry beyond five minutes from verification time', async () => {
  const now = Date.UTC(2026, 5, 19)
  const created = await createOAuthState('secret', 'account-a', now + 1_000)

  assert.equal(await verifyOAuthState('secret', created.state, now), null)
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

test('state carries only the requested purpose and nonce', async () => {
  const now = Date.UTC(2026, 5, 19)
  const created = await createOAuthState('secret', 'cron', now)
  const payload = await verifyOAuthState('secret', created.state, now)
  assert.deepEqual(payload, {
    v: 1,
    nonce: created.nonce,
    purpose: 'cron',
    exp: Math.floor(now / 1000) + 300,
  })
})

test('state rejects unsupported purpose after payload tampering', async () => {
  const created = await createOAuthState('secret', 'account-b')
  const [payload, signature] = created.state.split('.')
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString())
  decoded.purpose = 'admin'
  const changed = Buffer.from(JSON.stringify(decoded)).toString('base64url') + '.' + signature
  assert.equal(await verifyOAuthState('secret', changed), null)
})

test('parseOAuthPurposeBody rejects null arrays non-objects and malformed purpose values', () => {
  assert.equal(typeof security.parseOAuthPurposeBody, 'function')
  const parseOAuthPurposeBody = security.parseOAuthPurposeBody as (value: unknown) => OAuthPurpose | null

  for (const value of [
    undefined,
    null,
    [],
    'cron',
    1,
    true,
    {},
    { purpose: null },
    { purpose: 1 },
    { purpose: '' },
    { purpose: '   ' },
    { purpose: 'admin' },
  ]) {
    assert.equal(parseOAuthPurposeBody(value), null)
  }
})

test('parseOAuthPurposeBody accepts only supported oauth purposes', () => {
  assert.equal(typeof security.parseOAuthPurposeBody, 'function')
  const parseOAuthPurposeBody = security.parseOAuthPurposeBody as (value: unknown) => OAuthPurpose | null

  assert.equal(parseOAuthPurposeBody({ purpose: 'account-a' }), 'account-a')
  assert.equal(parseOAuthPurposeBody({ purpose: 'account-b' }), 'account-b')
  assert.equal(parseOAuthPurposeBody({ purpose: 'cron' }), 'cron')
})

test('parseOAuthExchangeBody rejects null arrays non-objects and malformed code or state', () => {
  assert.equal(typeof security.parseOAuthExchangeBody, 'function')
  const parseOAuthExchangeBody = security.parseOAuthExchangeBody as (
    value: unknown,
  ) => { code: string; state: string } | null

  for (const value of [
    undefined,
    null,
    [],
    'code',
    1,
    true,
    {},
    { code: 'ok' },
    { state: 'ok' },
    { code: null, state: 'ok' },
    { code: 1, state: 'ok' },
    { code: '', state: 'ok' },
    { code: '   ', state: 'ok' },
    { code: 'ok', state: null },
    { code: 'ok', state: 1 },
    { code: 'ok', state: '' },
    { code: 'ok', state: '   ' },
  ]) {
    assert.equal(parseOAuthExchangeBody(value), null)
  }
})

test('parseOAuthExchangeBody accepts only non-blank string code and state', () => {
  assert.equal(typeof security.parseOAuthExchangeBody, 'function')
  const parseOAuthExchangeBody = security.parseOAuthExchangeBody as (
    value: unknown,
  ) => { code: string; state: string } | null

  assert.deepEqual(parseOAuthExchangeBody({ code: 'oauth-code', state: 'oauth-state' }), {
    code: 'oauth-code',
    state: 'oauth-state',
  })
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

test('compare source uses a fixed safe account error message', async () => {
  const source = await readFile(new URL('./compare.ts', import.meta.url), 'utf8')

  assert.match(source, /error: '获取收藏失败，请稍后重试'/)
  assert.equal(source.includes('err.message'), false)
  assert.equal(source.includes('String(err)'), false)
})

test('sync-write source uses a fixed safe item error message', async () => {
  const source = await readFile(new URL('./sync-write.ts', import.meta.url), 'utf8')

  assert.match(source, /status:\s*'error',[\s\S]*error:\s*'同步失败，请稍后重试'/)
  assert.equal(source.includes('error: String(err)'), false)
  assert.equal(source.includes('error: err.message'), false)
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

test('sync failure logs keep only fixed structured fields', () => {
  const log = createSyncFailureLog(
    'account',
    namedError('BgmHttpError', 'username=ian access_token=secret upstream body', { status: 502 }),
    '2026-06-19T00:00:00.000Z',
  )
  assert.deepEqual(log, {
    event: 'sync_failed',
    phase: 'account',
    kind: 'BgmHttpError',
    upstream_status: 502,
    at: '2026-06-19T00:00:00.000Z',
  })
  assert.doesNotMatch(JSON.stringify(log), /message|request|state|code|token|username|body|secret/i)

  const unknown = createSyncFailureLog(
    'scheduled',
    namedError('access_token=secret', 'refresh_token=secret'),
    '2026-06-19T00:00:00.000Z',
  )
  assert.equal(unknown.kind, 'Unknown')
  assert.doesNotMatch(JSON.stringify(unknown), /access_token|refresh_token|secret/i)
})

test('worker sync logging calls never receive errors usernames or free text', async () => {
  const [workerSource, syncWorkerSource, cronSource] = await Promise.all([
    readFile(new URL('../index.ts', import.meta.url), 'utf8'),
    readFile(new URL('../sync-worker.ts', import.meta.url), 'utf8'),
    readFile(new URL('../cron.ts', import.meta.url), 'utf8'),
  ])
  const source = `${workerSource}\n${syncWorkerSource}\n${cronSource}`

  // cron.ts 新实现直接抛错，不再使用 createSyncFailureLog
  assert.doesNotMatch(cronSource, /createSyncFailureLog/)
  // cron.ts phase logging uses console.log with structured JSON only
  assert.doesNotMatch(cronSource, /console\.(?:error|warn)\(/)
  // sync-worker.ts 负责同步失败日志
  assert.match(syncWorkerSource, /createSyncFailureLog\('manual', err\)/)
  assert.match(syncWorkerSource, /createSyncFailureLog\('scheduled', err\)/)
  // 非结构化 console 调用不得泄露错误详情/用户名/自由文本
  assert.doesNotMatch(
    source,
    /console\.(?:error|warn|log)\((?!JSON\.stringify)[^)]*(?:err|error|reason|user|BANGUMI_USERS)/,
  )
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

test('worker source protect public routes with CORS, no manage gate', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')

  assert.ok(source.includes("const publicCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] })"))
  for (const route of ['/api/collections', '/api/calendar', '/api/config', '/api/health']) {
    assert.ok(source.includes(`app.use('${route}', publicCors)`), `expected public CORS on ${route}`)
  }

  assert.equal(source.includes("app.use('*', cors("), false)
  // No manage auth middleware — manage endpoints are open
  assert.ok(!source.includes('authorizeManageRequest'), 'no auth middleware')
  assert.ok(!source.includes("app.use('/api/manage/*', async (c, next)"), 'no manage middleware')

  assert.equal(source.includes("app.get('/api/manage/oauth-url'"), false)
  assert.equal(source.includes("app.get('/api/manage/exchange'"), false)
  assert.equal(source.includes("c.req.query('code')"), false)
  assert.equal(source.includes("c.req.query('cron')"), false)
})

test('worker source imports OAuthPurpose as a type-only import', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')

  assert.match(source, /import type \{ OAuthPurpose \} from '\.\/manage\/security'/)
})

test('worker source validates oauth-url body with parseOAuthPurposeBody and returns state plus nonce', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const oauthUrlBlockMatch = source.match(/app\.post\('\/api\/manage\/oauth-url',(?: async)? \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(oauthUrlBlockMatch, 'expected oauth-url handler source block')
  const oauthUrlBlock = oauthUrlBlockMatch[0]

  assert.match(oauthUrlBlock, /parseOAuthPurposeBody\(await c\.req\.json\(\)\.catch\(\(\) => null\)\)/)
  assert.match(oauthUrlBlock, /if \(!purpose\) \{[\s\S]*?return publicError\(400, 'INVALID_REQUEST'\)/)
  assert.match(oauthUrlBlock, /return publicError\(400, 'INVALID_REQUEST'\)/)
  assert.match(oauthUrlBlock, /return publicError\(503, 'OAUTH_NOT_CONFIGURED'\)/)
  assert.match(oauthUrlBlock, /createOAuthState\([\s\S]*?MANAGE_SECRET[\s\S]*?purpose\)/)
  assert.match(oauthUrlBlock, /return Response\.json\(\{[\s\S]*url:[\s\S]*state:[\s\S]*nonce:/)
})

test('worker source validates oauth exchange body before upstream and preserves token contract', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const exchangeBlockMatch = source.match(/app\.post\('\/api\/manage\/exchange',(?: async)? \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(exchangeBlockMatch, 'expected exchange handler source block')
  const exchangeBlock = exchangeBlockMatch[0]

  assert.match(exchangeBlock, /parseOAuthExchangeBody\(await c\.req\.json\(\)\.catch\(\(\) => null\)\)/)
  assert.match(exchangeBlock, /if \(!body\) \{[\s\S]*?return publicError\(400, 'INVALID_REQUEST'\)/)
  assert.match(exchangeBlock, /const state = await verifyOAuthState\([\s\S]*?MANAGE_SECRET[\s\S]*?body\.state\)/)
  assert.match(exchangeBlock, /if \(!state\) \{[\s\S]*?return publicError\(400, 'INVALID_OAUTH_STATE'\)/)
  assert.match(exchangeBlock, /if \(!c\.env\.BANGUMI_CLIENT_ID \|\| !c\.env\.BANGUMI_CLIENT_SECRET\) \{[\s\S]*?return publicError\(503, 'OAUTH_NOT_CONFIGURED'\)/)
  assert.ok(exchangeBlock.indexOf('verifyOAuthState') < exchangeBlock.indexOf('exchangeCode'))
  assert.match(exchangeBlock, /if \(state\.purpose === 'cron'\) \{/)
  assert.match(exchangeBlock, /await storage\.put\('bgm:tokens', \{/)
  assert.match(exchangeBlock, /refresh_token: result\.refresh_token/)
  assert.match(exchangeBlock, /return Response\.json\(\{ ok: true \}\)/)
  assert.match(exchangeBlock, /return Response\.json\(\{ access_token: result\.access_token, user_id: result\.user_id \}\)/)
})

test('worker source keeps health endpoint free of usernames in free text', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const healthBlockMatch = source.match(/app\.get\('\/api\/health', async \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(healthBlockMatch, 'expected health handler source block')
  const healthBlock = healthBlockMatch[0]

  // last_error 作为诊断字段是刻意暴露的，但不应包含用户名等自由文本
  assert.equal(healthBlock.includes('users:'), false)
  assert.match(
    healthBlock,
    /const log = createHealthFailureLog\(err\)\s*console\.error\(JSON\.stringify\(log\)\)/,
  )
  assert.match(healthBlock, /return Response\.json\(\{ ok: false \}/)
})

test('worker source verifies state before exchange and never returns refresh token', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const exchangeBlockMatch = source.match(/app\.post\('\/api\/manage\/exchange', async \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(exchangeBlockMatch, 'expected exchange handler source block')
  const exchangeBlock = exchangeBlockMatch[0]

  assert.match(exchangeBlock, /parseOAuthExchangeBody\(await c\.req\.json\(\)\.catch\(\(\) => null\)\)/)
  assert.match(exchangeBlock, /if \(!body\) \{[\s\S]*?return publicError\(400, 'INVALID_REQUEST'\)/)
  assert.match(exchangeBlock, /const state = await verifyOAuthState\([\s\S]*?MANAGE_SECRET[\s\S]*?body\.state\)/)
  assert.match(exchangeBlock, /if \(!state\) \{[\s\S]*?return publicError\(400, 'INVALID_OAUTH_STATE'\)/)
  assert.match(exchangeBlock, /if \(!c\.env\.BANGUMI_CLIENT_ID \|\| !c\.env\.BANGUMI_CLIENT_SECRET\) \{[\s\S]*return publicError\(503, 'OAUTH_NOT_CONFIGURED'\)/)
  assert.match(exchangeBlock, /await exchangeCode\([\s\S]*body\.code/)
  assert.match(exchangeBlock, /if \(state\.purpose === 'cron'\) \{[\s\S]*await storage\.put\('bgm:tokens', \{[\s\S]*access_token: result\.access_token,[\s\S]*refresh_token: result\.refresh_token,[\s\S]*\}\)[\s\S]*return Response\.json\(\{ ok: true \}\)/)
  assert.match(exchangeBlock, /return Response\.json\(\{ access_token: result\.access_token, user_id: result\.user_id \}\)/)
  assert.equal(exchangeBlock.includes('return Response.json(result)'), false)
  assert.equal(exchangeBlock.includes('refresh_token: result.refresh_token') && exchangeBlock.includes("return Response.json({ access_token: result.access_token, user_id: result.user_id })"), true)
})

test('public errors expose a fixed oauth not configured message', async () => {
  const response = publicError(503, 'OAUTH_NOT_CONFIGURED', new Error('client_secret missing'))
  const body = await response.text()
  assert.deepEqual(JSON.parse(body), {
    error: { code: 'OAUTH_NOT_CONFIGURED', message: 'OAuth is not configured' },
  })
  assert.doesNotMatch(body, /client_secret|missing/i)
})

test('worker source catches cron token delete failures and maps them safely', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const deleteBlockMatch = source.match(/app\.delete\('\/api\/manage\/cron-token', async \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(deleteBlockMatch, 'expected cron token delete handler source block')
  const deleteBlock = deleteBlockMatch[0]

  assert.match(deleteBlock, /try \{/)
  assert.match(deleteBlock, /await storage\.delete\('bgm:tokens'\)/)
  assert.match(deleteBlock, /catch \(err\) \{\s*return errorToResponse\('\/api\/manage\/cron-token', err, storage\)/)
})

test('callback with opener posts code and state to current origin then closes window', () => {
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

test('callback without opener stays open and shows a fixed manual copy prompt', () => {
  const html = oauthCallbackHtml()
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/)
  assert.ok(scriptMatch, 'expected callback html to contain inline script')

  const fallback = { hidden: true, textContent: 'OAuth 回调已完成。请复制地址栏中的完整 URL，返回管理页手动粘贴。' }
  let closed = false

  vm.runInNewContext(scriptMatch[1], {
    URLSearchParams,
    location: {
      search: '?code=sensitive-code&state=sensitive-state',
      origin: 'https://worker.example',
    },
    document: {
      getElementById(id: string) {
        return id === 'manual-copy' ? fallback : null
      },
    },
    window: {
      opener: null,
      close() {
        closed = true
      },
    },
  })

  assert.equal(closed, false)
  assert.equal(fallback.hidden, false)
  assert.equal(fallback.textContent, 'OAuth 回调已完成。请复制地址栏中的完整 URL，返回管理页手动粘贴。')
  assert.doesNotMatch(fallback.textContent, /sensitive-code|sensitive-state/)
})
