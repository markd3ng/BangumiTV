import { describe, it, mock } from 'node:test'
import assert from 'node:assert/strict'
import { downloadImagesWithLimit } from './download.ts'
import type { ImageStore } from './store.ts'
import { BgmClient } from '@bangumi-tv/shared'

function arrayBufferFrom(str: string): ArrayBuffer {
  return new TextEncoder().encode(str).buffer
}

function createMockImageStore(): ImageStore {
  return {
    putOriginal: mock.fn(async () => {}),
    getOriginal: mock.fn(async () => null),
    getVariant: mock.fn(async () => null),
    putVariant: mock.fn(async () => {}),
  }
}

function createMockBgmClient(
  results: Array<{ data: ArrayBuffer; contentType: string } | null>,
): BgmClient {
  let callIndex = 0
  return {
    ...new BgmClient(),
    downloadImage: mock.fn(async (_url: string) => {
      return results[callIndex++] ?? null
    }),
  } as unknown as BgmClient
}

// ── 场景 1: 全部成功 ──

it('全部成功 — 3 个有效 URL 返回 3 个 hash', async () => {
  const results = [
    { data: arrayBufferFrom('data-1'), contentType: 'image/jpeg' },
    { data: arrayBufferFrom('data-2'), contentType: 'image/webp' },
    { data: arrayBufferFrom('data-3'), contentType: 'image/png' },
  ]
  const mockClient = createMockBgmClient(results)
  const store = createMockImageStore()

  const entries = [
    { url: 'https://example.com/a.jpg', subjectId: 10 },
    { url: 'https://example.com/b.jpg', subjectId: 20 },
    { url: 'https://example.com/c.jpg', subjectId: 30 },
  ]

  const hashMap = await downloadImagesWithLimit(entries, store, mockClient, 3)

  assert.equal(hashMap.size, 3)
  assert.ok(hashMap.has(10))
  assert.ok(hashMap.has(20))
  assert.ok(hashMap.has(30))
  for (const hash of hashMap.values()) {
    assert.equal(hash.length, 64)
    assert.ok(/^[0-9a-f]{64}$/.test(hash))
  }
})

// ── 场景 2: 下载失败降级 ──

it('下载失败降级 — null 结果不中断其余', async () => {
  const results = [
    { data: arrayBufferFrom('img-1'), contentType: 'image/jpeg' },
    null as unknown as { data: ArrayBuffer; contentType: string },
    { data: arrayBufferFrom('img-3'), contentType: 'image/png' },
  ]
  const mockClient = createMockBgmClient(results)
  const store = createMockImageStore()

  const entries = [
    { url: 'https://example.com/1.jpg', subjectId: 1 },
    { url: 'https://example.com/2.jpg', subjectId: 2 },
    { url: 'https://example.com/3.jpg', subjectId: 3 },
  ]

  const hashMap = await downloadImagesWithLimit(entries, store, mockClient, 1)

  assert.equal(hashMap.size, 2)
  assert.ok(hashMap.has(1))
  assert.ok(!hashMap.has(2))
  assert.ok(hashMap.has(3))
  assert.equal(store.putOriginal.mock.callCount(), 2)
})

// ── 场景 3: 空输入 ──

it('空输入 — 返回空 Map', async () => {
  const mockClient = createMockBgmClient([])
  const store = createMockImageStore()

  const hashMap = await downloadImagesWithLimit([], store, mockClient, 2)

  assert.equal(hashMap.size, 0)
  assert.equal(store.putOriginal.mock.callCount(), 0)
})
