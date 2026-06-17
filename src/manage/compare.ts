import { BgmClient, type BgmCollection } from '../sync/bgm-client'
import { fetchAllCollections } from '../sync/utils'

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

export async function compareAccounts(
  tokenA: string,
  userA: string,
  tokenB: string,
  userB: string,
): Promise<CompareResult> {
  const [colA, colB] = await Promise.all([
    fetchAllCollections(new BgmClient(tokenA), userA),
    fetchAllCollections(new BgmClient(tokenB), userB),
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
