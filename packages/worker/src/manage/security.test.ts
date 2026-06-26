import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  createHealthFailureLog,
  createManageErrorLog,
  createSyncFailureLog,
  manageHeaders,
  publicError,
} from './security.ts'

function namedError(name: string, message: string, extra?: Record<string, unknown>): Error {
  return Object.assign(new Error(message), { name }, extra)
}

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

test('compare source logs real error to ring buffer, returns safe reason', async () => {
  const source = await readFile(new URL('./compare.ts', import.meta.url), 'utf8')

  assert.match(source, /console\.error\(JSON\.stringify\(\{ event: 'manage_compare_fetch_failed'/)
  assert.match(source, /error: reason/)
  assert.equal(source.includes('err.message'), false, 'no raw err.message in response')
  assert.equal(source.includes('settled.reason.message'), true, 'reason extracted safely')
})

test('sync-write source logs real error reason and returns it safely', async () => {
  const source = await readFile(new URL('./sync-write.ts', import.meta.url), 'utf8')

  assert.match(source, /const reason = err instanceof Error \? err\.message : String\(err\)/)
  assert.match(source, /error: reason/)
})

test('manage error logs keep only safe structured fields', () => {
  const authLog = createManageErrorLog(
    '/api/manage/sync',
    namedError('BgmHttpError', 'access_token=secret upstream body', { status: 403 }),
    '2026-06-19T00:00:00.000Z',
  )
  assert.deepEqual(authLog, {
    event: 'manage_request_failed',
    route: '/api/manage/sync',
    kind: 'BgmHttpError',
    upstream_status: 403,
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

  assert.doesNotMatch(cronSource, /createSyncFailureLog/)
  assert.doesNotMatch(cronSource, /console\.(?:error|warn)\(/)
  assert.match(syncWorkerSource, /createSyncFailureLog\('manual', err\)/)
  assert.match(syncWorkerSource, /createSyncFailureLog\('scheduled', err\)/)
  assert.doesNotMatch(
    source,
    /console\.(?:error|warn|log)\((?!JSON\.stringify)[^)]*(?:err|error|reason|user|BANGUMI_USERS)/,
  )
})

test('worker exposes public sync APIs but not legacy manage page or OAuth routes', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')

  assert.ok(source.includes("const publicCors = cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] })"))
  for (const route of ['/api/collections', '/api/calendar', '/api/config', '/api/health']) {
    assert.ok(source.includes(`app.use('${route}', publicCors)`), `expected public CORS on ${route}`)
  }

  assert.equal(source.includes("app.get('/manage'"), false)
  assert.equal(source.includes("app.get('/manage/callback'"), false)
  assert.equal(source.includes("app.post('/api/manage/oauth-url'"), false)
  assert.equal(source.includes("app.post('/api/manage/exchange'"), false)
  assert.equal(source.includes('/manage/callback'), false)
  assert.equal(source.includes('createOAuthState'), false)
  assert.equal(source.includes('verifyOAuthState'), false)
  assert.equal(source.includes('exchangeCode'), false)
  assert.ok(source.includes("app.post('/api/manage/compare'"), 'compare API route remains available')
  assert.ok(source.includes("app.post('/api/manage/sync'"), 'sync API route remains available')
})

test('worker source keeps health endpoint free of usernames in free text', async () => {
  const source = await readFile(new URL('../index.ts', import.meta.url), 'utf8')
  const healthBlockMatch = source.match(/app\.get\('\/api\/health', async \(c\) => \{[\s\S]*?\n\}\)\n/)
  assert.ok(healthBlockMatch, 'expected health handler source block')
  const healthBlock = healthBlockMatch[0]

  assert.equal(healthBlock.includes('users:'), false)
  assert.match(
    healthBlock,
    /const log = createHealthFailureLog\(err\)\s*console\.error\(JSON\.stringify\(log\)\)/,
  )
  assert.match(healthBlock, /return Response\.json\(\{ ok: false \}/)
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
