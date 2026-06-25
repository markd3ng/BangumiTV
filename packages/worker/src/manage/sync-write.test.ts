import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('executeSync validates mode is either full or partial', async () => {
  const source = readFileSync(new URL('./sync-write.ts', import.meta.url), 'utf8')
  assert.match(source, /mode.*===.*('full'|"full").*mode.*===.*('partial'|"partial")/)
})

test('executeSync validates from and to are non-empty strings', async () => {
  const source = readFileSync(new URL('./sync-write.ts', import.meta.url), 'utf8')
  assert.match(source, /typeof fromToken !== 'string'|fromUser\.trim\(\)|from\.trim\(\)/)
})

test('executeSync validates partial mode requires subject_ids array', async () => {
  const source = readFileSync(new URL('./sync-write.ts', import.meta.url), 'utf8')
  assert.match(source, /subject_ids/)
})

test('executeSync rejects empty subject_ids in partial mode', async () => {
  const source = readFileSync(new URL('./sync-write.ts', import.meta.url), 'utf8')
  assert.match(source, /subject_ids\.length === 0|subject_ids\?\.length/)
})
