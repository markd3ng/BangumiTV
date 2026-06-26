import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('./bangumi.js', import.meta.url), 'utf8')

test('public sync sends compared usernames instead of display placeholders', () => {
  assert.ok(source.includes('syncState.data.userA.name'), 'reads account A username from compare result')
  assert.ok(source.includes('syncState.data.userB.name'), 'reads account B username from compare result')
  assert.ok(source.includes("var fromUser = dir === 'A->B' ? nameA : nameB"), 'uses real source username')
  assert.ok(source.includes("var toUser = dir === 'A->B' ? nameB : nameA"), 'uses real target username')
  assert.equal(source.includes("var fromUser = dir === 'A->B' ? 'A' : 'B'"), false)
})

test('public sync result shows backend result count for diagnosis', () => {
  assert.ok(source.includes('var expected = ids.length'), 'computes expected sync count')
  assert.ok(source.includes("msg += '<br><small>"), 'renders diagnostic summary')
  assert.ok(source.includes('results.length'), 'uses actual response array length')
})

test('public sync uses sync API routes and no legacy manage routes', () => {
  assert.ok(source.includes("API + '/api/sync/compare'"), 'calls sync compare endpoint')
  assert.ok(source.includes("API + '/api/sync/apply'"), 'calls sync apply endpoint')
  assert.equal(source.includes('/api/manage/compare'), false)
  assert.equal(source.includes('/api/manage/sync'), false)
})

test('public full sync batches source ids to avoid one huge worker request', () => {
  assert.ok(source.includes('var SYNC_BATCH_SIZE = 35'), 'uses a worker-safe batch size')
  assert.ok(source.includes('getFullSyncIds(dir)'), 'full sync derives source ids from compare data')
  assert.ok(source.includes("syncState.data.differences || []"), 'includes changed entries')
  assert.ok(source.includes("dir === 'A->B' ? syncState.data.onlyA : syncState.data.onlyB"), 'includes source-only entries')
  assert.ok(source.includes('syncState.data.same || []'), 'includes unchanged source entries for full sync')
  assert.ok(source.includes("mode: 'partial'"), 'sends backend chunk requests as partial batches')
  assert.ok(source.includes('for (var start = 0; start < ids.length; start += SYNC_BATCH_SIZE)'), 'iterates batches')
  assert.ok(source.includes("Math.round(done / expected * 100) + '%'"), 'updates progress per completed batch')
})
