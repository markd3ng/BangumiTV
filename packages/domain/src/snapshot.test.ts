import assert from 'node:assert/strict'
import test from 'node:test'
import { imageRef, mergeCollections, subjectMetaFromNotFound } from './index.ts'

test('imageRef creates the new public URI and R2 key contract from a byte hash', () => {
  assert.deepEqual(imageRef('a'.repeat(64)), {
    hash: 'a'.repeat(64),
    uri: `/image/${'a'.repeat(64)}`,
    r2_key: `images/${'a'.repeat(64)}/original`,
  })
})

test('mergeCollections writes common and large image refs without legacy hash fields', () => {
  const merged = mergeCollections([
    {
      subject_id: 23080,
      subject_type: 2,
      type: 3,
      rate: 8,
      ep_status: 1,
      vol_status: 0,
      tags: [],
      comment: '',
      private: false,
      updated_at: '2026-06-29T00:00:00.000Z',
      subject: { id: 23080, name: 'A', name_cn: 'A CN', summary: '', date: '', eps: 12, total_episodes: 12 },
    },
  ], new Map([
    [23080, { common: imageRef('b'.repeat(64)), large: imageRef('c'.repeat(64)) }],
  ]), new Map([[23080, { nsfw: true }]]))

  const entry = merged.watching[0] as any
  assert.equal(entry.images.common.hash, 'b'.repeat(64))
  assert.equal(entry.images.large.hash, 'c'.repeat(64))
  assert.equal(entry.nsfw, true)
  assert.equal('hash' in entry.images, false)
  assert.equal('hash_large' in entry.images, false)
})

test('subjectMetaFromNotFound applies conservative NSFW policy', () => {
  assert.deepEqual(subjectMetaFromNotFound(23080, 1782650000), {
    subject_id: 23080,
    exists: false,
    nsfw: true,
    checked_at: 1782650000,
    reason: 'not_found_or_restricted',
  })
})
