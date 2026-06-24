import { BgmClient, type BgmCollection } from '@bangumi-tv/shared'
import { fetchAllCollections } from '@bangumi-tv/shared'

export interface CompareResult {
  userA: { name: string; collections: BgmCollection[]; total: number; error?: string }
  userB: { name: string; collections: BgmCollection[]; total: number; error?: string }
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
  _userA: string,
  tokenB: string,
  _userB: string,
): Promise<CompareResult> {
  // 从 token 解析真实用户名（bgm.tv GET /v0/me）
  const client = new BgmClient()
  const [meA, meB] = await Promise.allSettled([
    client.getMe(tokenA),
    client.getMe(tokenB),
  ])
  const userA = meA.status === 'fulfilled' ? meA.value.username : (_userA || 'Account A')
  const userB = meB.status === 'fulfilled' ? meB.value.username : (_userB || 'Account B')

  const [settledA, settledB] = await Promise.allSettled([
    fetchAllCollections(new BgmClient(tokenA), userA),
    fetchAllCollections(new BgmClient(tokenB), userB),
  ])

  function unwrap(settled: PromiseSettledResult<BgmCollection[]>, name: string) {
    if (settled.status === 'fulfilled') {
      return { name, collections: settled.value, total: settled.value.length }
    }
    const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
    console.error(JSON.stringify({ event: 'manage_compare_fetch_failed', user: name, reason, at: new Date().toISOString() }))
    return { name, collections: [] as BgmCollection[], total: 0, error: reason }
  }

  const colA = unwrap(settledA, userA)
  const colB = unwrap(settledB, userB)

  // 如果双方都失败，直接返回无差异
  if (colA.error && colB.error) {
    return { userA: colA, userB: colB, common: 0, differences: [] }
  }

  const mapA = new Map(colA.collections.map(c => [c.subject_id, c]))
  const mapB = new Map(colB.collections.map(c => [c.subject_id, c]))

  const differences: Difference[] = []
  const allIds = new Set([...mapA.keys(), ...mapB.keys()])

  for (const id of allIds) {
    const a = mapA.get(id)
    const b = mapB.get(id)

    // 双方都有的才进入差异比较
    if (a && b) {
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
    } else if (a && !b) {
      // 仅 A 持有：标记为 B 无此条目
      differences.push({
        subject_id: id,
        name: a.subject?.name ?? '',
        name_cn: a.subject?.name_cn ?? '',
        images: a.subject?.images ?? { large: '', common: '', medium: '', small: '', grid: '' },
        typeA: a.type,
        typeB: 0,
        epStatusA: a.ep_status,
        epStatusB: 0,
        volStatusA: a.vol_status,
        volStatusB: 0,
        rateA: a.rate,
        rateB: 0,
      })
    } else if (!a && b) {
      // 仅 B 持有：标记为 A 无此条目
      differences.push({
        subject_id: id,
        name: b.subject?.name ?? '',
        name_cn: b.subject?.name_cn ?? '',
        images: b.subject?.images ?? { large: '', common: '', medium: '', small: '', grid: '' },
        typeA: 0,
        typeB: b.type,
        epStatusA: 0,
        epStatusB: b.ep_status,
        volStatusA: 0,
        volStatusB: b.vol_status,
        rateA: 0,
        rateB: b.rate,
      })
    }
  }

  return {
    userA: colA,
    userB: colB,
    common: [...allIds].filter(id => mapA.has(id) && mapB.has(id)).length,
    differences,
  }
}
