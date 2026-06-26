import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('compare source keeps only-side entries out of differences', async () => {
  const source = await readFile(new URL('./compare.ts', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /onlyA\.push\(d\);\s*differences\.push\(d\)/)
  assert.doesNotMatch(source, /onlyB\.push\(d\);\s*differences\.push\(d\)/)
})

test('compare source treats status score and progress as differences', async () => {
  const source = await readFile(new URL('./compare.ts', import.meta.url), 'utf8')

  assert.match(source, /a\.status === b\.status && a\.progress === b\.progress && a\.score === b\.score/)
})
