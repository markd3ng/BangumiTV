import type { StorageAdapter } from '../storage/adapter'
import type { MergedCollections, MergedEntry } from '../sync/merger'

const VALID_TYPES = ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const
type CollectionType = (typeof VALID_TYPES)[number]

const BUCKETS: readonly CollectionType[] = VALID_TYPES

function parsePositiveInt(raw: string | null, fallback: number): number {
  const n = parseInt(raw ?? '', 10)
  return Number.isNaN(n) || n < 1 ? fallback : n
}

export async function handleCollections(
  storage: StorageAdapter,
  url: URL,
  nsfwEnvShow: boolean,
): Promise<Response> {
  const rawType = url.searchParams.get('type') || 'watching'
  const type: CollectionType = (VALID_TYPES as readonly string[]).includes(rawType)
    ? (rawType as CollectionType)
    : 'watching'
  const page = parsePositiveInt(url.searchParams.get('page'), 1)
  const limit = Math.min(parsePositiveInt(url.searchParams.get('limit'), 24), 100)

  // 环境变量 NSFW_SHOW=false 时一律不返回 NSFW；为 true 时允许 ?nsfw=false 显式过滤。
  const nsfwShow = nsfwEnvShow && url.searchParams.get('nsfw') !== 'false'

  const merged = await storage.get<MergedCollections>('collections:merged')
  if (!merged) {
    return Response.json({ data: [], total: 0, page, limit, types: emptyTypes() })
  }

  // 先按 NSFW 开关过滤每个分桶，确保 total 与 types 计数一致。
  const filteredBuckets: Record<CollectionType, MergedEntry[]> = {
    want: [],
    watched: [],
    watching: [],
    on_hold: [],
    dropped: [],
  }
  const types = emptyTypes()
  for (const key of BUCKETS) {
    const bucket = (merged[key] as MergedEntry[] | undefined) ?? []
    const filtered = nsfwShow ? bucket : bucket.filter((e) => !e.nsfw)
    filteredBuckets[key] = filtered
    types[key] = filtered.length
  }

  const list = filteredBuckets[type]
  const total = list.length
  const start = (page - 1) * limit
  const data = list.slice(start, start + limit)

  return Response.json({ data, total, page, limit, types })
}

function emptyTypes(): Record<CollectionType, number> {
  return { want: 0, watched: 0, watching: 0, on_hold: 0, dropped: 0 }
}
