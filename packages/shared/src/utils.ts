import { BgmClient, type BgmCollection } from './bgm-client'

export async function fetchAllCollections(client: BgmClient, username: string): Promise<BgmCollection[]> {
  const all: BgmCollection[] = []
  const limit = 30
  let offset = 0

  try {
    while (true) {
      const { data } = await client.getCollections(username, offset, limit)
      if (data.length === 0) break
      all.push(...data)
      offset += limit
      // 还有更多数据才延迟，避免末页多余等待
      if (data.length === limit) await new Promise(r => setTimeout(r, 200))
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`获取用户 ${username} 的收藏时失败：${msg}`, { cause: err })
  }

  return all
}
