import assert from 'node:assert/strict'
import test from 'node:test'
import { SyncLock, type AcquireResponse } from './sync-lock.ts'

/** 辅助：为每个测试创建独立的 SyncLock 实例 + 模拟 storage。 */
function createSyncLock(): {
  lock: SyncLock
  alarms: number[]
  deleteAlarmCalls: () => number
} {
  const alarms: number[] = []
  let deleteAlarmCalls = 0
  const mockStorage = {
    setAlarm: async (t: number) => { alarms.push(t) },
    deleteAlarm: async () => { deleteAlarmCalls++ },
  } as unknown as DurableObjectState['storage']

  const ctx = { storage: mockStorage } as unknown as DurableObjectState
  const lock = new SyncLock(ctx)
  return { lock, alarms, deleteAlarmCalls: () => deleteAlarmCalls }
}

test('SyncLock acquire returns true when not locked', async () => {
  const { lock } = createSyncLock()
  const req = new Request('http://do/acquire')
  const res = await lock.fetch(req)
  assert.equal(res.status, 200)
  const body = await res.json() as AcquireResponse
  assert.equal(body.acquired, true)
})

test('SyncLock second acquire returns false while still locked', async () => {
  const { lock } = createSyncLock()
  await lock.fetch(new Request('http://do/acquire'))
  const res = await lock.fetch(new Request('http://do/acquire'))
  const body = await res.json() as AcquireResponse
  assert.equal(body.acquired, false)
})

test('SyncLock release unlocks and allows re-acquire', async () => {
  const { lock } = createSyncLock()
  await lock.fetch(new Request('http://do/acquire'))
  await lock.fetch(new Request('http://do/release'))
  const res = await lock.fetch(new Request('http://do/acquire'))
  const body = await res.json() as AcquireResponse
  assert.equal(body.acquired, true)
})

test('SyncLock alarm clears lock', async () => {
  const { lock } = createSyncLock()
  await lock.fetch(new Request('http://do/acquire'))
  await lock.alarm()
  const res = await lock.fetch(new Request('http://do/acquire'))
  const body = await res.json() as AcquireResponse
  assert.equal(body.acquired, true)
})

test('SyncLock acquire with custom ttl', async () => {
  const { lock } = createSyncLock()
  const req = new Request('http://do/acquire?ttl=600')
  const res = await lock.fetch(req)
  const body = await res.json() as AcquireResponse
  assert.equal(body.acquired, true)
})
