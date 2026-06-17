import { BgmClient, type BgmCollection } from '../sync/bgm-client'

export interface CompareResult {
  userA: { name: string; collections: BgmCollection[]; total: number }
  userB: { name: string; collections: BgmCollection[]; total: number }
  common: number
  differences: Difference[]
}

export interface Difference {
  subject_id: number
  name: string
  name_cn: string
  images: { large: string; common: string; medium: string; small: string; grid: string }
  typeA: number
  typeB: number
  epStatusA: number
  epStatusB: number
  volStatusA: number
  volStatusB: number
  rateA: number
  rateB: number
}

async function fetchAll(token: string, username: string): Promise<BgmCollection[]> {
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

export async function compareAccounts(
  tokenA: string,
  userA: string,
  tokenB: string,
  userB: string,
): Promise<CompareResult> {
  const [colA, colB] = await Promise.all([
    fetchAll(tokenA, userA),
    fetchAll(tokenB, userB),
  ])

  const mapA = new Map(colA.map(c => [c.subject_id, c]))
  const mapB = new Map(colB.map(c => [c.subject_id, c]))

  const differences: Difference[] = []
  const allIds = new Set([...mapA.keys(), ...mapB.keys()])

  for (const id of allIds) {
    const a = mapA.get(id)
    const b = mapB.get(id)
    if (!a || !b) continue

    if (a.type !== b.type || a.ep_status !== b.ep_status || a.vol_status !== b.vol_status || a.rate !== b.rate) {
      differences.push({
        subject_id: id,
        name: a.subject?.name ?? b.subject?.name ?? '',
        name_cn: a.subject?.name_cn ?? b.subject?.name_cn ?? '',
        images: a.subject?.images ?? b.subject?.images ?? { large: '', common: '', medium: '', small: '', grid: '' },
        typeA: a.type,
        typeB: b.type,
        epStatusA: a.ep_status,
        epStatusB: b.ep_status,
        volStatusA: a.vol_status,
        volStatusB: b.vol_status,
        rateA: a.rate,
        rateB: b.rate,
      })
    }
  }

  return {
    userA: { name: userA, collections: colA, total: colA.length },
    userB: { name: userB, collections: colB, total: colB.length },
    common: [...allIds].filter(id => mapA.has(id) && mapB.has(id)).length,
    differences,
  }
}
