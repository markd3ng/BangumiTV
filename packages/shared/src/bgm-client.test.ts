import assert from 'node:assert/strict'
import test from 'node:test'
import { BgmClient } from './bgm-client.ts'
import { BgmPlatformClient } from './platform/bgm.ts'
import { WatchStatus } from './platform/client.ts'

// 辅助：模拟 fetch 响应的简单工厂
function mockFetch(status: number, body: unknown, ok?: boolean): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const responseBody = typeof body === 'string' ? body : JSON.stringify(body)
    return new Response(responseBody, {
      status,
      statusText: ok !== false && status >= 200 && status < 300 ? 'OK' : 'Error',
    }) as unknown as Response
  }
}

function mockNetworkError(): typeof globalThis.fetch {
  return async () => { throw new TypeError('fetch failed') }
}

function captureFetch(status = 204): { calls: { url: string; init?: RequestInit }[]; fetch: typeof globalThis.fetch } {
  const calls: { url: string; init?: RequestInit }[] = []
  return {
    calls,
    fetch: async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response(null, { status }) as unknown as Response
    },
  }
}

test('tokenStatus returns valid when 2xx and valid:true', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(200, { valid: true, expires: 2000000000 })
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'valid', expires: 2000000000 })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns invalid when 2xx but response lacks valid:true', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(200, { valid: false })
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'invalid' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns invalid when 2xx with invalid JSON', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(200, '<html>error</html>')
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'invalid' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns invalid on 401', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(401, 'Unauthorized')
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'invalid' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns invalid on 403', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(403, 'Forbidden')
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'invalid' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns probe_failed on 5xx', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockFetch(502, 'Bad Gateway')
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'probe_failed' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('tokenStatus returns probe_failed on network error', async () => {
  const client = new BgmClient('test-token')
  const originalFetch = globalThis.fetch
  globalThis.fetch = mockNetworkError()
  try {
    const result = await client.tokenStatus('test-token')
    assert.deepEqual(result, { status: 'probe_failed' })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('patchCollection accepts 204 No Content without parsing JSON', async () => {
  const client = new BgmClient()
  const originalFetch = globalThis.fetch
  globalThis.fetch = captureFetch().fetch
  try {
    const result = await client.patchCollection('token', 265, { type: 3 })
    assert.equal(result, undefined)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('BgmPlatformClient upserts collection with POST and omits book-only progress fields', async () => {
  const client = new BgmPlatformClient()
  const originalFetch = globalThis.fetch
  const captured = captureFetch()
  globalThis.fetch = captured.fetch
  try {
    await client.patchEntry('token', '265', {
      externalId: '265',
      title: 'Neon Genesis Evangelion',
      status: WatchStatus.WATCHING,
      progress: 26,
      totalEpisodes: 26,
      score: 9,
      platform: 'bgm',
    })

    assert.equal(captured.calls.length, 1)
    assert.equal(captured.calls[0].init?.method, 'POST')
    assert.equal(captured.calls[0].url, 'https://api.bgm.tv/v0/users/-/collections/265')
    assert.equal(captured.calls[0].init?.headers && (captured.calls[0].init.headers as Record<string, string>).Authorization, 'Bearer token')
    assert.deepEqual(JSON.parse(String(captured.calls[0].init?.body)), {
      type: 3,
      rate: 9,
      tags: [],
      comment: '',
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})
