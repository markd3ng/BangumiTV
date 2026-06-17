import { BgmClient, type BgmCollection } from './bgm-client'

export async function fetchAllCollections(client: BgmClient, username: string): Promise<BgmCollection[]> {
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
