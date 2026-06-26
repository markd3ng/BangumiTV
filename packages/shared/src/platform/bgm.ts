import { BgmClient } from '../bgm-client'
import { fetchAllCollections } from '../utils'
import { type PlatformClient, type ComparisonItem, type AccountInfo, WatchStatus, type PlatformId, type PatchEntryOptions, type PatchEntryResult } from './client'

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

type EpisodeCollectionType = 0 | 1 | 2 | 3

function episodeTypeMap(entries: Array<{ episode: { id: number }; type: EpisodeCollectionType }>): Map<number, EpisodeCollectionType> {
  return new Map(entries.map((entry) => [entry.episode.id, entry.type]))
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

  async patchEntry(token: string, externalId: string, item: ComparisonItem, options?: PatchEntryOptions): Promise<PatchEntryResult> {
    const client = new BgmClient()
    const bgmType = WATCH_STATUS_TO_BGM[item.status] || 3
    // 不要发送会清空目标账号标签/评论的字段；动画进度走 episode collection API。
    await client.upsertCollection(token, Number(externalId), {
      type: bgmType,
      rate: item.score,
    })

    const progressResult = options?.sourceToken
      ? await this.syncEpisodeProgress(client, options.sourceToken, token, Number(externalId), item.totalEpisodes)
      : { episodeChanged: 0, episodeProgress: { before: item.progress, after: item.progress, total: item.totalEpisodes } }

    return progressResult
  }

  private async syncEpisodeProgress(client: BgmClient, sourceToken: string, targetToken: string, subjectId: number, totalEpisodes: number): Promise<PatchEntryResult> {
    const [source, target] = await Promise.all([
      client.getSubjectEpisodeCollections(sourceToken, subjectId),
      client.getSubjectEpisodeCollections(targetToken, subjectId),
    ])
    const sourceMap = episodeTypeMap(source.data)
    const targetMap = episodeTypeMap(target.data)
    const before = [...targetMap.values()].filter((type) => type === 2).length
    const after = [...sourceMap.values()].filter((type) => type === 2).length
    const total = totalEpisodes || Math.max(sourceMap.size, targetMap.size)
    const changedByType = new Map<EpisodeCollectionType, number[]>()
    const ids = new Set([...sourceMap.keys(), ...targetMap.keys()])

    for (const episodeId of ids) {
      const sourceType = sourceMap.get(episodeId) ?? 0
      const targetType = targetMap.get(episodeId) ?? 0
      if (sourceType === targetType) continue
      const bucket = changedByType.get(sourceType) || []
      bucket.push(episodeId)
      changedByType.set(sourceType, bucket)
    }

    let changed = 0
    for (const [type, episodeIds] of changedByType) {
      if (!episodeIds.length) continue
      await client.patchSubjectEpisodeCollections(targetToken, subjectId, episodeIds, type)
      changed += episodeIds.length
    }

    return { episodeChanged: changed, episodeProgress: { before, after, total } }
  }
}
