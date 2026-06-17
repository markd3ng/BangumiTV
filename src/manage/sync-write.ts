import { BgmClient, type BgmCollection } from '../sync/bgm-client'

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

async function fetchAllWithToken(token: string, username: string): Promise<BgmCollection[]> {
  const client = new BgmClient(token)
  const all: BgmCollection[] = []
  const first = await client.getCollections(username, 0, 1)
  if (first.total === 0) return []

  const limit = 50
  const pages = Math.ceil(first.total / limit)
  for (let p = 0; p < pages; p++) {
    const { data } = await client.getCollections(username, p * limit, limit)
    all.push(...data)
    if (p < pages - 1) await new Promise(r => setTimeout(r, 200))
  }
  return all
}

export async function executeSync(
  fromToken: string,
  fromUser: string,
  toToken: string,
  toUser: string,
  request: SyncRequest,
): Promise<SyncResult[]> {
  const fromCol = await fetchAllWithToken(fromToken, fromUser)
  const fromMap = new Map(fromCol.map(c => [c.subject_id, c]))

  const toCol = await fetchAllWithToken(toToken, toUser)
  const toMap = new Map(toCol.map(c => [c.subject_id, c]))

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
      results.push({ subject_id: entry.subject_id, name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id), status: 'ok' })
    } catch (err) {
      results.push({ subject_id: entry.subject_id, name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id), status: 'error', error: String(err) })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  return results
}
