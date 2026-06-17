import type { StorageAdapter } from '../storage/adapter'
import type { MergedCollections } from '../sync/merger'

export async function handleCollections(storage: StorageAdapter, url: URL): Promise<Response> {
  const type = url.searchParams.get('type') || 'watching'
  const page = parseInt(url.searchParams.get('page') || '1')
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '24'), 100)
  const nsfwShow = url.searchParams.get('nsfw') !== 'false'

  const merged = await storage.get<MergedCollections>('collections:merged')
  if (!merged) return Response.json({ data: [], total: 0, page: 1, types: {} })

  let list = (merged as Record<string, unknown[]>)[type] as unknown[] | undefined
  if (!list) list = []

  if (!nsfwShow) list = list.filter((e: Record<string, unknown>) => !e.nsfw)

  const total = list.length
  const start = (page - 1) * limit
  const data = list.slice(start, start + limit)

  const types = { want: 0, watched: 0, watching: 0, on_hold: 0, dropped: 0 }
  for (const key of Object.keys(types)) {
    types[key as keyof typeof types] = (merged[key as keyof MergedCollections] as unknown[]).length
  }

  return Response.json({ data, total, page, limit, types })
}
