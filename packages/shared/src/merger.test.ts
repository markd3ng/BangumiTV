import assert from 'node:assert/strict'
import test from 'node:test'
import type { BgmCollection } from './bgm-client.ts'
import { merge, primaryMerge } from './merger.ts'

function makeCollection(overrides: Partial<BgmCollection> & { subject_id: number }): BgmCollection {
  return {
    subject_type: 2,
    rate: 0,
    type: 3,
    comment: '',
    tags: [],
    ep_status: 0,
    vol_status: 0,
    updated_at: '',
    private: false,
    ...overrides,
  }
}

test('merge without imageHashMap produces images.hash === null', () => {
  const collections = [
    makeCollection({
      subject_id: 1,
      subject: {
        id: 1,
        type: 2,
        name: 'Test Anime',
        name_cn: '',
        summary: '',
        nsfw: false,
        date: '2024-01-01',
        eps: 12,
        total_episodes: 12,
        images: { large: 'https://example.com/large.jpg', common: '', medium: '', small: '', grid: '' },
        rating: { score: 8, rank: 100, total: 1000 },
      },
    }),
  ]

  const result = merge([collections])
  assert.equal(result.watching.length, 1)
  const entry = result.watching[0]
  assert.equal(entry.images.hash, null)
  assert.equal(entry.images.w, 300)
  assert.equal(entry.images.h, 400)
})

test('merge without imageHashMap and without subject images produces images.hash === null, w:0, h:0', () => {
  const collections = [
    makeCollection({
      subject_id: 2,
    }),
  ]

  const result = merge([collections])
  assert.equal(result.watching.length, 1)
  const entry = result.watching[0]
  assert.equal(entry.images.hash, null)
  assert.equal(entry.images.w, 0)
  assert.equal(entry.images.h, 0)
})

test('merge with imageHashMap sets hash for matching subject_id', () => {
  const imageHashMap = new Map<number, string>()
  imageHashMap.set(1, 'abc123def')

  const collections = [
    makeCollection({
      subject_id: 1,
      subject: {
        id: 1,
        type: 2,
        name: 'Test Anime',
        name_cn: '',
        summary: '',
        nsfw: false,
        date: '2024-01-01',
        eps: 12,
        total_episodes: 12,
        images: { large: 'https://example.com/large.jpg', common: '', medium: '', small: '', grid: '' },
        rating: { score: 8, rank: 100, total: 1000 },
      },
    }),
  ]

  const result = merge([collections], imageHashMap)
  assert.equal(result.watching.length, 1)
  const entry = result.watching[0]
  assert.equal(entry.images.hash, 'abc123def')
})

test('merge with imageHashMap produces null for non-matching subject_id', () => {
  const imageHashMap = new Map<number, string>()
  imageHashMap.set(999, 'somehash')

  const collections = [
    makeCollection({
      subject_id: 1,
      subject: {
        id: 1,
        type: 2,
        name: 'Test Anime',
        name_cn: '',
        summary: '',
        nsfw: false,
        date: '2024-01-01',
        eps: 12,
        total_episodes: 12,
        images: { large: 'https://example.com/large.jpg', common: '', medium: '', small: '', grid: '' },
        rating: { score: 8, rank: 100, total: 1000 },
      },
    }),
  ]

  const result = merge([collections], imageHashMap)
  assert.equal(result.watching.length, 1)
  const entry = result.watching[0]
  assert.equal(entry.images.hash, null)
})

test('primaryMerge passes imageHashMap through', () => {
  const imageHashMap = new Map<number, string>()
  imageHashMap.set(1, 'hash123')

  const collections = [
    makeCollection({
      subject_id: 1,
      subject: {
        id: 1,
        type: 2,
        name: 'Test Anime',
        name_cn: '',
        summary: '',
        nsfw: false,
        date: '2024-01-01',
        eps: 12,
        total_episodes: 12,
        images: { large: 'https://example.com/large.jpg', common: '', medium: '', small: '', grid: '' },
        rating: { score: 8, rank: 100, total: 1000 },
      },
    }),
  ]

  const result = primaryMerge(collections, imageHashMap)
  assert.equal(result.watching.length, 1)
  const entry = result.watching[0]
  assert.equal(entry.images.hash, 'hash123')
})
