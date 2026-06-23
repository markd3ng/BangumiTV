import type { StorageAdapter } from '@bangumi-tv/shared'
import type { MergedEntry } from '@bangumi-tv/shared'

const VALID_TYPES = ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const
type CollectionType = (typeof VALID_TYPES)[number]

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

  const nsfwShow = nsfwEnvShow && url.searchParams.get('nsfw') !== 'false'

  // 仅读当前 type 的数据（~2-50KB），不再读 150KB+ 全量快照
  const bucket = (await storage.get<MergedEntry[]>(`collections:${type}`)) || []
  const list = nsfwShow ? bucket : bucket.filter((e) => !e.nsfw)
  const total = list.length
  const start = (page - 1) * limit
  const data = list.slice(start, start + limit)

  // 分类计数从轻量 summary key 读取
  const sm = await storage.get<Record<string, number>>('collections:summary')
  const types: Record<string, number> = {}
  for (const key of VALID_TYPES) {
    types[key] = sm?.[key] ?? 0
  }

  return Response.json({ data, total, page, limit, types })
}
