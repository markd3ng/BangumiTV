import assert from 'node:assert/strict'
import test from 'node:test'
import type { StorageAdapter } from '@bangumi-tv/shared'
import type { SyncSnapshot } from './snapshot.ts'

// 使用动态 import 避免类型问题
let getSnapshot: (storage: StorageAdapter) => Promise<SyncSnapshot | null>

test('setup', async () => {
  const mod = await import('./snapshot.ts')
  getSnapshot = mod.getSnapshot
})

function createMockStorage(store: Record<string, unknown>): StorageAdapter {
  return {
    get: async <T>(key: string) => (store[key] ?? null) as T | null,
    put: async <T>(key: string, value: T) => { store[key] = value },
    delete: async (key: string) => { delete store[key] },
  }
}

test('getSnapshot returns sync:snapshot when present', async () => {
  const snap: SyncSnapshot = {
    collections: { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: '2026-06-22T00:00:00Z' },
    calendar: [],
    meta: { synced_at: 1750600000, mode: 'merge', generation: 5 },
  }
  const storage = createMockStorage({ 'sync:snapshot': snap })
  const result = await getSnapshot(storage)
  assert.deepEqual(result, snap)
})

test('getSnapshot falls back to legacy keys when sync:snapshot missing', async () => {
  const storage = createMockStorage({
    'collections:merged': { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: '2026-06-20T00:00:00Z' },
    'calendar': [{ weekday: { en: 'Mon', cn: '周一', ja: '月曜日', id: 1 }, items: [] }],
  })
  const result = await getSnapshot(storage)
  assert.notEqual(result, null)
  assert.equal(result!.meta.generation, 0)
  assert.equal(result!.meta.synced_at, 0)
  assert.equal(result!.meta.mode, 'merge')
  assert.deepEqual(result!.collections, { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: '2026-06-20T00:00:00Z' })
  assert.equal(result!.calendar.length, 1)
})

test('getSnapshot returns null when neither key exists', async () => {
  const storage = createMockStorage({})
  const result = await getSnapshot(storage)
  assert.equal(result, null)
})

test('getSnapshot returns collections-only fallback when calendar missing', async () => {
  const storage = createMockStorage({
    'collections:merged': { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: '2026-06-20T00:00:00Z' },
  })
  const result = await getSnapshot(storage)
  assert.notEqual(result, null)
  assert.deepEqual(result!.calendar, [])
})
