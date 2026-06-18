import { BgmClient, type BgmCollection } from '@bangumi-tv/shared'
import { fetchAllCollections } from '@bangumi-tv/shared'

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

export async function executeSync(
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
      results.push({ subject_id: entry.subject_id, name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id), status: 'ok' })
    } catch (err) {
      results.push({ subject_id: entry.subject_id, name: entry.subject?.name_cn || entry.subject?.name || String(entry.subject_id), status: 'error', error: String(err) })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  return results
}
