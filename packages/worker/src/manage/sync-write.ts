import { BgmClient, type BgmCollection } from '@bangumi-tv/shared'
import { fetchAllCollections } from '@bangumi-tv/shared'
import { getSyncLockStub } from '../sync-lock.ts'

export interface SyncRequest {
  mode: 'full' | 'partial'
  from: string
  to: string
  subject_ids?: number[]
}

export interface SyncResult {
  subject_id: number
  name: string
  status: 'ok' | 'error'
  error?: string
}

/** 输入校验。失败抛错，错误消息固定安全。 */
function validateSyncRequest(request: SyncRequest): void {
  const { mode } = request
  if (!(mode === 'full' || mode === 'partial')) {
    throw new Error('Invalid sync mode')
  }
  if (!request.from || !request.to || !request.from.trim() || !request.to.trim()) {
    throw new Error('Missing source/target user')
  }
  if (mode === 'partial') {
    if (!Array.isArray(request.subject_ids) || request.subject_ids.length === 0) {
      throw new Error('Partial sync requires subject_ids')
    }
    if (request.subject_ids.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new Error('Invalid subject_ids')
    }
  }
}

export async function executeSync(
  fromToken: string,
  fromUser: string,
  toToken: string,
  toUser: string,
  request: SyncRequest,
  env?: { SYNCLOCK: DurableObjectNamespace },
): Promise<SyncResult[]> {
  // 输入校验（提前，不调 bgm.tv）
  validateSyncRequest(request)

  // 同步互斥
  if (env?.SYNCLOCK) {
    const stub = getSyncLockStub(env)
    const acquireRes = await stub.fetch(new Request('http://do/acquire'))
    const { acquired } = await acquireRes.json() as { acquired: boolean }
    if (!acquired) {
      throw new Error('Another sync is in progress; try again later')
    }
    try {
      return await doSync(fromToken, fromUser, toToken, toUser, request)
    } finally {
      await stub.fetch(new Request('http://do/release'))
    }
  }

  return doSync(fromToken, fromUser, toToken, toUser, request)
}

async function doSync(
  fromToken: string,
  fromUser: string,
  toToken: string,
  toUser: string,
  request: SyncRequest,
): Promise<SyncResult[]> {
  const fromCol = await fetchAllCollections(new BgmClient(fromToken), fromUser)

  let targets: BgmCollection[]
  if (request.mode === 'full') {
    targets = fromCol
  } else {
    const ids = new Set(request.subject_ids || [])
    targets = fromCol.filter(c => ids.has(c.subject_id))
  }

  const client = new BgmClient()
  const results: SyncResult[] = []

  for (const entry of targets) {
    try {
      const body: Record<string, unknown> = {
        type: entry.type,
        rate: entry.rate,
        ep_status: entry.ep_status,
        vol_status: entry.vol_status,
        tags: entry.tags || [],
        comment: entry.comment || '',
      }
      await client.patchCollection(toToken, entry.subject_id, body)
      results.push({
        subject_id: entry.subject_id,
        name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id),
        status: 'ok',
      })
    } catch (err) {
      console.warn(JSON.stringify({ event: 'sync_item_failed', subject_id: entry.subject_id, reason: err instanceof Error ? err.message : String(err), at: new Date().toISOString() }))
      results.push({
        subject_id: entry.subject_id,
        name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id),
        status: 'error',
        error: '同步失败，请稍后重试',
      })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  return results
}
