import { BgmClient, type TokenStatus } from '@bangumi-tv/shared'
import { merge, primaryMerge, type MergedCollections } from '@bangumi-tv/shared'
import type { StorageAdapter } from '@bangumi-tv/shared'
import { fetchAllCollections } from '@bangumi-tv/shared'
import type { SyncSnapshot, SyncSnapshotMeta } from './storage/snapshot.ts'
import { downloadImagesWithLimit, type DownloadEntry } from './image/download.ts'
import type { ImageStore } from './image/store.ts'

// ── 类型 ──

interface StoredTokens {
  access_token: string
  refresh_token: string
}

export interface SyncErrorLog {
  timestamp: number
  error: string
  stage: 'token_refresh' | 'fetch_collections' | 'fetch_calendar' | 'write_snapshot' | 'lock_timeout'
}

// ── 常量 ──

const KV_TOKEN_KEY = 'bgm:tokens'
const SNAPSHOT_KEY = 'sync:snapshot'
const LAST_ERROR_KEY = 'sync:last_error'
const LAST_SUCCESS_KEY = 'sync:last_success'
const REFRESH_GRACE_SECONDS = 3600

// ── Token 刷新 ▸ 适配三态 ──

async function ensureFreshToken(
  storage: StorageAdapter,
  env: {
    BANGUMI_TOKEN: string
    BANGUMI_REFRESH_TOKEN?: string
    BANGUMI_CLIENT_ID?: string
    BANGUMI_CLIENT_SECRET?: string
  },
): Promise<string> {
  const stored = await storage.get<StoredTokens>(KV_TOKEN_KEY)
  const current: StoredTokens | null = stored
    ? { access_token: stored.access_token, refresh_token: stored.refresh_token }
    : env.BANGUMI_REFRESH_TOKEN
      ? { access_token: env.BANGUMI_TOKEN, refresh_token: env.BANGUMI_REFRESH_TOKEN }
      : env.BANGUMI_TOKEN
        ? { access_token: env.BANGUMI_TOKEN, refresh_token: '' }
        : null

  if (!current) {
    throw new Error('No valid bgm.tv token: configure BANGUMI_TOKEN/BANGUMI_REFRESH_TOKEN or run /manage to authorize')
  }

  const probe = new BgmClient()
  const status: TokenStatus = await probe.tokenStatus(current.access_token)
  const nowSec = Math.floor(Date.now() / 1000)

  // probe_failed → 放弃，不消费 refresh_token
  if (status.status === 'probe_failed') {
    throw new Error('bgm.tv token probe failed (network/5xx); skipping sync')
  }

  // invalid → 必须刷新
  if (status.status === 'invalid') {
    if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET || !current.refresh_token) {
      throw new Error('bgm.tv token invalid and no refresh credentials configured')
    }
    return refreshAndPersist(storage, probe, env, current)
  }

  // valid → 检查是否临近过期
  const needsRefresh = typeof status.expires === 'number' && status.expires - nowSec < REFRESH_GRACE_SECONDS
  if (!needsRefresh) return current.access_token

  // 临近过期 → 尝试提前刷新
  if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET || !current.refresh_token) {
    return current.access_token // 有效但无法刷新，凑合用
  }
  return refreshAndPersist(storage, probe, env, current)
}

async function refreshAndPersist(
  storage: StorageAdapter,
  probe: BgmClient,
  env: { BANGUMI_CLIENT_ID?: string; BANGUMI_CLIENT_SECRET?: string },
  current: StoredTokens,
): Promise<string> {
  const refreshed = await probe.refreshAccessToken(
    env.BANGUMI_CLIENT_ID!,
    env.BANGUMI_CLIENT_SECRET!,
    current.refresh_token,
  )
  await storage.put<StoredTokens>(KV_TOKEN_KEY, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
  })
  return refreshed.access_token
}

// ── 日历精简 ──

function transformCalendar(raw: Awaited<ReturnType<BgmClient['getCalendar']>>) {
  return raw.map((d) => ({
    weekday: d.weekday,
    items: d.items
      .filter((item) => item.name_cn !== '' || item.name !== '')
      .map((item) => {
        const { collection, rating, rank: _rank, ...rest } = item as Record<string, unknown>
        return rest
      }),
  }))
}

// ── 主同步函数 ──

export async function runSync(
  storage: StorageAdapter,
  imageStore: ImageStore,
  env: {
    BANGUMI_TOKEN: string
    BANGUMI_REFRESH_TOKEN?: string
    BANGUMI_CLIENT_ID?: string
    BANGUMI_CLIENT_SECRET?: string
    BANGUMI_USERS: string[]
    BANGUMI_PRIMARY_USER?: string
    SYNC_MODE: string
  },
): Promise<{ merged: MergedCollections; calendar: ReturnType<typeof transformCalendar>; generation: number }> {
  // 1. Token 刷新（三态适配）
  const token = await ensureFreshToken(storage, env)

  if (env.BANGUMI_USERS.length === 0) {
    throw new Error('sync: BANGUMI_USERS is empty — nothing to sync')
  }

  const client = new BgmClient(token)

  // 2. 拉取所有用户收藏
  const settled = await Promise.allSettled(env.BANGUMI_USERS.map((u) => fetchAllCollections(client, u)))

  // 3. Primary 保护
  let merged: MergedCollections
  if (env.SYNC_MODE === 'primary' && env.BANGUMI_PRIMARY_USER) {
    const idx = env.BANGUMI_USERS.indexOf(env.BANGUMI_PRIMARY_USER)
    if (idx === -1) throw new Error(`Primary user ${env.BANGUMI_PRIMARY_USER} not in users list`)

    const primaryResult = settled[idx as number]
    if (!primaryResult || primaryResult.status === 'rejected') {
      throw new Error(`Primary user (${env.BANGUMI_PRIMARY_USER}) fetch failed; aborting sync`)
    }
    if (primaryResult.value.length === 0) {
      throw new Error(`Primary user (${env.BANGUMI_PRIMARY_USER}) returned empty collections; aborting sync`)
    }
    merged = primaryMerge(primaryResult.value)
  } else {
    // Merge 模式：只合并成功的
    const anySuccess = settled.some((s) => s.status === 'fulfilled')
    if (!anySuccess) {
      const details = settled
        .map((s, i) => {
          if (s.status === 'rejected') {
            const msg = s.reason instanceof Error ? s.reason.message : String(s.reason)
            return `${env.BANGUMI_USERS[i]}: ${msg}`
          }
          return null
        })
        .filter(Boolean)
        .join('; ')
      throw new Error(`sync: all users failed — ${details}`)
    }
    const allCollections = settled.map((s) =>
      s.status === 'fulfilled' ? s.value : ([] as Awaited<ReturnType<typeof fetchAllCollections>>),
    )
    merged = merge(allCollections)
  }

  // 3.5 图片下载：收集所有有封面的条目，限流下载并写入 R2
  const imageEntries: DownloadEntry[] = []
  for (const collections of settled) {
    if (collections.status !== 'fulfilled') continue
    for (const c of collections.value) {
      if (c.subject?.images?.large) {
        imageEntries.push({ url: c.subject.images.large, subjectId: c.subject_id })
      }
    }
  }
  const imageHashMap = imageEntries.length > 0
    ? await downloadImagesWithLimit(imageEntries, imageStore, client)
    : undefined

  // 3.6 带图片 hash 重新合并
  if (env.SYNC_MODE === 'primary' && env.BANGUMI_PRIMARY_USER) {
    // Primary 模式：重新合并（已有 merged from primaryMerge）
    const idx = env.BANGUMI_USERS.indexOf(env.BANGUMI_PRIMARY_USER)
    const primaryResult = settled[idx as number]
    if (primaryResult?.status === 'fulfilled' && primaryResult.value.length > 0) {
      merged = primaryMerge(primaryResult.value, imageHashMap)
    }
  } else {
    const anySuccess = settled.some((s) => s.status === 'fulfilled')
    if (anySuccess) {
      const allCollections = settled.map((s) =>
        s.status === 'fulfilled' ? s.value : ([] as Awaited<ReturnType<typeof fetchAllCollections>>),
      )
      merged = merge(allCollections, imageHashMap)
    }
  }

  // 4. 拉取日历
  let calendar: ReturnType<typeof transformCalendar>
  try {
    calendar = transformCalendar(await client.getCalendar())
  } catch (err) {
    throw new Error(`Calendar fetch failed; aborting sync: ${err instanceof Error ? err.message : String(err)}`)
  }

  // 5. 写快照（仅完整成功才写）
  // 读取当前 generation
  const previousSnap = await storage.get<SyncSnapshot>(SNAPSHOT_KEY)
  const generation = previousSnap ? previousSnap.meta.generation + 1 : 1

  const meta: SyncSnapshotMeta = {
    synced_at: Math.floor(Date.now() / 1000),
    mode: env.SYNC_MODE === 'primary' ? 'primary' : 'merge',
    ...(env.SYNC_MODE === 'primary' && env.BANGUMI_PRIMARY_USER ? { primary_user: env.BANGUMI_PRIMARY_USER } : {}),
    generation,
  }

  const snapshot: SyncSnapshot = { collections: merged, calendar, meta }
  await storage.put(SNAPSHOT_KEY, snapshot)
  await storage.put(LAST_SUCCESS_KEY, new Date().toISOString())
  await storage.delete(LAST_ERROR_KEY)

  return { merged, calendar, generation }
}
