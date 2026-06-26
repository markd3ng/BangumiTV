import { type PlatformClient, type ComparisonItem } from '@bangumi-tv/shared'
import { getSyncLockStub } from '../sync-lock.ts'

export interface SyncRequest {
  mode: 'full' | 'partial'
  from: string
  to: string
  subject_ids?: string[]
}

export interface SyncResult {
  externalId: string
  title: string
  status: 'ok' | 'error'
  episodeChanged?: number
  episodeProgress?: {
    before: number
    after: number
    total: number
  }
  error?: string
}

function validateSyncRequest(request: SyncRequest): void {
  if (!(request.mode === 'full' || request.mode === 'partial')) {
    throw new Error('Invalid sync mode')
  }
  if (!request.from || !request.to || !request.from.trim() || !request.to.trim()) {
    throw new Error('Missing source/target user')
  }
  if (request.mode === 'partial') {
    if (!Array.isArray(request.subject_ids) || request.subject_ids.length === 0) {
      throw new Error('Partial sync requires subject_ids')
    }
  }
}

export async function executeSync(
  clientA: PlatformClient, fromToken: string,
  clientB: PlatformClient, toToken: string,
  request: SyncRequest,
  env?: { SYNCLOCK: DurableObjectNamespace },
): Promise<SyncResult[]> {
  validateSyncRequest(request)

  if (env?.SYNCLOCK) {
    const stub = getSyncLockStub(env)
    const acquireRes = await stub.fetch(new Request('http://do/acquire'))
    const { acquired } = await acquireRes.json() as { acquired: boolean }
    if (!acquired) throw new Error('Another sync is in progress; try again later')
    try {
      return await doSync(clientA, fromToken, clientB, toToken, request)
    } finally {
      await stub.fetch(new Request('http://do/release'))
    }
  }

  return doSync(clientA, fromToken, clientB, toToken, request)
}

async function doSync(
  clientA: PlatformClient, fromToken: string,
  clientB: PlatformClient, toToken: string,
  request: SyncRequest,
): Promise<SyncResult[]> {
  const sourceAccount = await clientA.getMe(fromToken)
  const fromCol = await clientA.fetchCollections(fromToken, sourceAccount.username)

  let targets: ComparisonItem[]
  if (request.mode === 'full') {
    targets = fromCol
  } else {
    const ids = new Set(request.subject_ids || [])
    targets = fromCol.filter(c => ids.has(c.externalId))
  }

  const results: SyncResult[] = []

  for (const entry of targets) {
    try {
      const result = await clientB.patchEntry(toToken, entry.externalId, entry, { sourceToken: fromToken })
      results.push({ externalId: entry.externalId, title: entry.title, status: 'ok', episodeChanged: result.episodeChanged, episodeProgress: result.episodeProgress })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      console.warn(JSON.stringify({ event: 'sync_item_failed', external_id: entry.externalId, reason, at: new Date().toISOString() }))
      results.push({ externalId: entry.externalId, title: entry.title, status: 'error', error: reason })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  return results
}
