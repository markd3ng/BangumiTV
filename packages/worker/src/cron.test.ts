import assert from 'node:assert/strict'
import test from 'node:test'
import type { StorageAdapter } from '@bangumi-tv/shared'
import type { ImageStore } from './image/store.ts'

// 使用动态导入，确保在类型可用后加载
let cronModule: typeof import('./cron.ts')

test('setup', async () => {
  cronModule = await import('./cron.ts')
})

function createMockStorage(store: Record<string, unknown> = {}): StorageAdapter {
  return {
    get: async <T>(key: string) => (store[key] ?? null) as T | null,
    put: async <T>(key: string, value: T) => { store[key] = value },
    delete: async (key: string) => { delete store[key] },
  }
}

const mockImageStore: ImageStore = {
  getOriginal: async () => null,
  putOriginal: async () => {},
  getVariant: async () => null,
  putVariant: async () => {},
}

// 模拟 token_status 返回有效 token，避免真实网络请求
function mockValidTokenFetch() {
  const original = globalThis.fetch
  globalThis.fetch = async (url: string | URL | Request) => {
    const urlStr = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url
    if (urlStr.includes('token_status')) {
      return new Response(JSON.stringify({ valid: true, expires: Math.floor(Date.now() / 1000) + 7200 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }) as unknown as Response
    }
    // 其他请求（getCalendar, getCollections 等）返回空数据
    if (urlStr.includes('calendar')) {
      return new Response(JSON.stringify([]), { status: 200 }) as unknown as Response
    }
    if (urlStr.includes('collections')) {
      return new Response(JSON.stringify({ data: [], total: 0 }), { status: 200 }) as unknown as Response
    }
    return original(url, undefined as any)
  }
  return () => { globalThis.fetch = original }
}

// ── 模块导出验证 ──

test('cron module exports runSync as a function', () => {
  assert.equal(typeof cronModule.runSync, 'function')
})

// ── SyncErrorLog 类型验证 ──

test('SyncErrorLog is exported with correct shape', () => {
  const log: cronModule.SyncErrorLog = {
    timestamp: 1718000000,
    error: 'test error',
    stage: 'fetch_collections',
  }
  assert.equal(log.timestamp, 1718000000)
  assert.equal(log.error, 'test error')
  assert.equal(log.stage, 'fetch_collections')
})

// ── runSync 错误：BANGUMI_USERS 为空 ──

test('runSync throws when BANGUMI_USERS is empty', async () => {
  const restore = mockValidTokenFetch()
  try {
    const storage = createMockStorage()
    await assert.rejects(
      () =>
        cronModule.runSync(storage, mockImageStore, {
          BANGUMI_TOKEN: 'test-token',
          BANGUMI_USERS: [],
          SYNC_MODE: 'merge',
        }),
      /BANGUMI_USERS is empty/,
    )
  } finally {
    restore()
  }
})

// ── runSync 错误：Primary 用户不在列表中 ──

test('runSync throws when primary user is not in users list', async () => {
  const restore = mockValidTokenFetch()
  try {
    const storage = createMockStorage()
    await assert.rejects(
      () =>
        cronModule.runSync(storage, mockImageStore, {
          BANGUMI_TOKEN: 'test-token',
          BANGUMI_USERS: ['user-a'],
          BANGUMI_PRIMARY_USER: 'nonexistent-user',
          SYNC_MODE: 'primary',
        }),
      /Primary user.*not in users list/,
    )
  } finally {
    restore()
  }
})

// ── runSync 成功写入 snapshot ──

test('runSync writes sync:snapshot key on success', async () => {
  const restore = mockValidTokenFetch()
  try {
    const store: Record<string, unknown> = {}
    const storage = createMockStorage(store)
    const result = await storage.get('sync:snapshot')
    assert.equal(result, null, 'no snapshot before sync')
    // 这需要日历和收藏都成功，我们的 mock 返回空数据
    // 由于 fetchAllCollections 会 fetch，而我们的 mock 处理 collections
    // 但用户 "user-a" 收藏为空 → primaryMerge 将成功合并
    // 注意：env.BANGUMI_USERS 是 string[] 类型
    const ret = await cronModule.runSync(storage, mockImageStore, {
      BANGUMI_TOKEN: 'test-token',
      BANGUMI_USERS: ['user-a', 'user-b'],
      SYNC_MODE: 'merge',
    })
    // 验证 snapshot 被写入
    const snapshot = await storage.get<any>('sync:snapshot')
    assert.notEqual(snapshot, null)
    assert.equal(snapshot.meta.mode, 'merge')
    assert.equal(typeof snapshot.meta.generation, 'number')
    assert.equal(snapshot.meta.generation, 1)

    // 验证 legacy keys 没有被写入
    const oldMerged = await storage.get('collections:merged')
    assert.equal(oldMerged, null)
    const oldCalendar = await storage.get('calendar')
    assert.equal(oldCalendar, null)

    // 验证成功标记
    const lastSuccess = await storage.get('sync:last_success')
    assert.notEqual(lastSuccess, null)
    assert.equal(typeof lastSuccess, 'string')
  } finally {
    restore()
  }
})
