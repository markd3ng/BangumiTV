import { BgmClient } from '../bgm-client'
import { fetchAllCollections } from '../utils'
import { type PlatformClient, type ComparisonItem, type AccountInfo, WatchStatus, type PlatformId } from './client'

const BGM_STATUS_MAP: Record<number, WatchStatus> = {
  1: WatchStatus.PLAN_TO_WATCH,
  2: WatchStatus.COMPLETED,
  3: WatchStatus.WATCHING,
  4: WatchStatus.ON_HOLD,
  5: WatchStatus.DROPPED,
}

const WATCH_STATUS_TO_BGM: Record<string, number> = {
  [WatchStatus.PLAN_TO_WATCH]: 1,
  [WatchStatus.COMPLETED]: 2,
  [WatchStatus.WATCHING]: 3,
  [WatchStatus.ON_HOLD]: 4,
  [WatchStatus.DROPPED]: 5,
}

export class BgmPlatformClient implements PlatformClient {
  readonly platform: PlatformId = 'bgm'

  async getMe(token: string): Promise<AccountInfo> {
    const client = new BgmClient()
    const me = await client.getMe(token)
    return { username: me.username, externalId: String(me.id), platform: 'bgm' }
  }

  async fetchCollections(token: string, username: string): Promise<ComparisonItem[]> {
    const collections = await fetchAllCollections(new BgmClient(token), username)
    return collections.map((c) => ({
      externalId: String(c.subject_id),
      title: c.subject?.name_cn || c.subject?.name || String(c.subject_id),
      status: BGM_STATUS_MAP[c.type] || WatchStatus.WATCHING,
      progress: c.ep_status,
      totalEpisodes: (c as any).eps || (c as any).total_episodes || 0,
      score: c.rate,
      platform: 'bgm' as PlatformId,
    }))
  }

  async patchEntry(token: string, externalId: string, item: ComparisonItem): Promise<void> {
    const client = new BgmClient()
    const bgmType = WATCH_STATUS_TO_BGM[item.status] || 3
    // ep_status/vol_status 仅对书籍条目有效（bgm API 文档），动画/电影/音乐 PATCH 不能传
    await client.patchCollection(token, Number(externalId), {
      type: bgmType,
      rate: item.score,
      tags: [],
      comment: '',
    })
  }
}
