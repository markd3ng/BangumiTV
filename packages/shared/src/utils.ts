import { BgmClient, type BgmCollection } from './bgm-client'

export async function fetchAllCollections(client: BgmClient, username: string): Promise<BgmCollection[]> {
  const all: BgmCollection[] = []
  const limit = 30

  try {
    const first = await client.getCollections(username, 0, limit)
    const total = first.total
    if (total === 0) return []
    all.push(...first.data)

    const pages = Math.ceil(total / limit)
    let offset = limit

    for (let p = 1; p < pages; p++) {
      const { data } = await client.getCollections(username, offset, limit)
      all.push(...data)
      offset += limit
      await new Promise(r => setTimeout(r, 200))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`获取用户 ${username} 的收藏时失败：${msg}`, { cause: err })
  }

  return all
}
