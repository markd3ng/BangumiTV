import type { StorageAdapter } from '@bangumi-tv/shared'
import type { MergedCollections } from '@bangumi-tv/shared'
import type { BgmCalendarItem } from '@bangumi-tv/shared'

export interface SyncSnapshotMeta {
  /** Unix 秒级时间戳（快照生成时间） */
  synced_at: number
  mode: 'merge' | 'primary'
  primary_user?: string
  /** 单调递增，从 1 开始 */
  generation: number
}

export interface SyncSnapshot {
  collections: MergedCollections
  calendar: BgmCalendarItem[]
  meta: SyncSnapshotMeta
}

const SNAPSHOT_KEY = 'sync:snapshot'
const LEGACY_COLLECTIONS_KEY = 'collections:merged'
const LEGACY_CALENDAR_KEY = 'calendar'

/**
 * 统一快照读取函数。
 * 优先读取新 key `sync:snapshot`；缺失时回退到旧 key（兼容过渡期）。
 */
export async function getSnapshot(storage: StorageAdapter): Promise<SyncSnapshot | null> {
  const snap = await storage.get<SyncSnapshot>(SNAPSHOT_KEY)
  if (snap) return snap

  // 旧 key 回退（1-2 周后移除）
  const collections = await storage.get<MergedCollections>(LEGACY_COLLECTIONS_KEY)
  const calendar = await storage.get<BgmCalendarItem[]>(LEGACY_CALENDAR_KEY) ?? []
  if (collections) {
    return {
      collections,
      calendar,
      meta: { synced_at: 0, mode: 'merge', generation: 0 },
    }
  }
  return null
}
