import { type PlatformClient, type ComparisonItem } from '@bangumi-tv/shared'

export interface CompareResult {
  userA: { name: string; total: number; error?: string }
  userB: { name: string; total: number; error?: string }
  common: number
  differences: Difference[]
  same: SameEntry[]
  onlyA: Difference[]
  onlyB: Difference[]
}

export interface Difference {
  externalId: string
  title: string
  statusA: string
  statusB: string
  progressA: number
  progressB: number
  scoreA: number
  scoreB: number
}

export interface SameEntry {
  externalId: string
  title: string
  status: string
  progress: number
  totalEpisodes: number
  score: number
}

function statusLabel(s: string): string {
  return ({ watching: '在看', completed: '看过', plan_to_watch: '想看', on_hold: '搁置', dropped: '抛弃' })[s] || s
}

export async function compareAccounts(
  clientA: PlatformClient,
  tokenA: string,
  clientB: PlatformClient,
  tokenB: string,
): Promise<CompareResult> {
  const [meA, meB] = await Promise.allSettled([
    clientA.getMe(tokenA),
    clientB.getMe(tokenB),
  ])
  const nameA = meA.status === 'fulfilled' ? meA.value.username : 'Account A'
  const nameB = meB.status === 'fulfilled' ? meB.value.username : 'Account B'

  const [settledA, settledB] = await Promise.allSettled([
    clientA.fetchCollections(tokenA, nameA),
    clientB.fetchCollections(tokenB, nameB),
  ])

  function unwrap(settled: PromiseSettledResult<ComparisonItem[]>, name: string) {
    if (settled.status === 'fulfilled') {
      return { name, items: settled.value, total: settled.value.length }
    }
    const reason = settled.reason instanceof Error ? settled.reason.message : String(settled.reason)
    console.error(JSON.stringify({ event: 'manage_compare_fetch_failed', user: name, reason, at: new Date().toISOString() }))
    return { name, items: [] as ComparisonItem[], total: 0, error: reason }
  }

  const colA = unwrap(settledA, nameA)
  const colB = unwrap(settledB, nameB)

  if (colA.error && colB.error) {
    return { userA: colA, userB: colB, common: 0, same: [], onlyA: [], onlyB: [], differences: [] }
  }

  const mapA = new Map(colA.items.map(c => [c.externalId, c]))
  const mapB = new Map(colB.items.map(c => [c.externalId, c]))

  const differences: Difference[] = []
  const same: SameEntry[] = []
  const onlyA: Difference[] = []
  const onlyB: Difference[] = []
  const allIds = new Set([...mapA.keys(), ...mapB.keys()])

  for (const id of allIds) {
    const a = mapA.get(id)
    const b = mapB.get(id)

    if (a && b) {
      if (a.status === b.status && a.progress === b.progress && a.score === b.score) {
        same.push({ externalId: id, title: a.title, status: statusLabel(a.status), progress: a.progress, totalEpisodes: a.totalEpisodes, score: a.score })
      } else {
        differences.push({ externalId: id, title: a.title || b.title, statusA: statusLabel(a.status), statusB: statusLabel(b.status), progressA: a.progress, progressB: b.progress, scoreA: a.score, scoreB: b.score })
      }
    } else if (a && !b) {
      const d: Difference = { externalId: id, title: a.title, statusA: statusLabel(a.status), statusB: '—', progressA: a.progress, progressB: 0, scoreA: a.score, scoreB: 0 }
      onlyA.push(d); differences.push(d)
    } else if (!a && b) {
      const d: Difference = { externalId: id, title: b.title, statusA: '—', statusB: statusLabel(b.status), progressA: 0, progressB: b.progress, scoreA: 0, scoreB: b.score }
      onlyB.push(d); differences.push(d)
    }
  }

  return {
    userA: colA, userB: colB,
    common: [...allIds].filter(id => mapA.has(id) && mapB.has(id)).length,
    same, onlyA, onlyB, differences,
  }
}
