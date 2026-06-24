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

  // Developer token（无 refresh_token，永不过期）→ 直接使用
  if (!current.refresh_token) return current.access_token

  // valid → 检查是否临近过期
  const needsRefresh = typeof status.expires === 'number' && status.expires - nowSec < REFRESH_GRACE_SECONDS
  if (!needsRefresh) return current.access_token

  // 临近过期 → 尝试提前刷新
  if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET) {
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

function transformCalendar(
  raw: Awaited<ReturnType<BgmClient['getCalendar']>>,
  imageHashMap?: Map<number, string>,
) {
  return raw.map((d) => ({
    weekday: d.weekday,
    items: d.items
      .filter((item) => item.name_cn !== '' || item.name !== '')
      .map((item) => {
        const { collection, rating, rank: _rank, ...rest } = item as unknown as Record<string, unknown>
        const entry = rest as any
        const hash = imageHashMap?.get(entry.id) ?? null
        return { ...entry, images: { ...entry.images, hash } }
      }),
  })) as typeof raw
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
  console.log(JSON.stringify({ event: 'sync_phase', phase: 'token_refresh', at: new Date().toISOString() }))
  const token = await ensureFreshToken(storage, env)
  console.log(JSON.stringify({ event: 'sync_phase', phase: 'token_ready', at: new Date().toISOString() }))

  if (env.BANGUMI_USERS.length === 0) {
    throw new Error('sync: BANGUMI_USERS is empty — nothing to sync')
  }

  const client = new BgmClient(token)

  // 2. 拉取所有用户收藏
  const settled = await Promise.allSettled(env.BANGUMI_USERS.map((u) => fetchAllCollections(client, u)))
  const succeeded = settled.filter((s) => s.status === 'fulfilled').length
  console.log(JSON.stringify({ event: 'sync_phase', phase: 'fetched_collections', users_total: env.BANGUMI_USERS.length, users_succeeded: succeeded, at: new Date().toISOString() }))

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

  // 3.5 图片下载：common（优先，卡片用）+ large（原图保留，背景下载）。
  // 两版共享 25 张限额。恢复旧 hash，common 优先 → 剩余预算下载 large。
  const commonEntries: DownloadEntry[] = []
  const largeEntries: DownloadEntry[] = []
  const collSubjectIds = new Set<number>()
  for (const collections of settled) {
    if (collections.status !== 'fulfilled') continue
    for (const c of collections.value) {
      collSubjectIds.add(c.subject_id)
      if (c.subject?.images?.common) {
        commonEntries.push({ url: c.subject.images.common, subjectId: c.subject_id, size: 'common' })
      }
      if (c.subject?.images?.large) {
        largeEntries.push({ url: c.subject.images.large, subjectId: c.subject_id, size: 'large' })
      }
    }
  }

  // 提前拉取日历（同时用于图片候选和后续 transform，避免重复 fetch）
  console.log(JSON.stringify({ event: 'sync_phase', phase: 'fetch_calendar', at: new Date().toISOString() }))
  const rawCalendar = await client.getCalendar().catch(() => null)
  if (rawCalendar) {
    for (const day of rawCalendar) {
      for (const item of day.items) {
        const calItem = item as any
        if (calItem.images?.common && calItem.id) {
          commonEntries.push({ url: calItem.images.common, subjectId: calItem.id, size: 'common' })
        }
        if (calItem.images?.large && calItem.id) {
          largeEntries.push({ url: calItem.images.large, subjectId: calItem.id, size: 'large' })
        }
      }
    }
  }

  // hashLarge 从旧快照恢复（包括旧的 images.hash 原是 large + images.hash_large）
  const hashCommon = new Map<number, string>()
  const hashLarge = new Map<number, string>()
  const prevSnap = await storage.get<SyncSnapshot>(SNAPSHOT_KEY)
  if (prevSnap) {
    for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
      for (const entry of (prevSnap.collections[key] || []) as any[]) {
        if (entry.images?.hash) hashLarge.set(entry.subject_id as number, entry.images.hash)
        if (entry.images?.hash_large) hashLarge.set(entry.subject_id as number, entry.images.hash_large)
      }
    }
    for (const day of (prevSnap.calendar || [])) {
      for (const item of (day.items || [])) {
        const ci = item as any
        if (ci.images?.hash) hashLarge.set(ci.id as number, ci.images.hash)
        if (ci.images?.hash_large) hashLarge.set(ci.id as number, ci.images.hash_large)
      }
    }
  }

  // common 下载：收藏 15 张 + 日历 3 张（避免日历被收藏挤掉）
  const collCommon = commonEntries.filter((e) => !hashCommon.has(e.subjectId))
  const newCollCommon = collCommon.filter((e: DownloadEntry) => collSubjectIds.has(e.subjectId)).slice(0, 15)
  const newCalCommon = collCommon.filter((e: DownloadEntry) => !collSubjectIds.has(e.subjectId)).slice(0, 3)
  const newCommon = [...newCollCommon, ...newCalCommon]
  if (newCommon.length > 0) {
    const newHashes = await downloadImagesWithLimit(newCommon, imageStore, client)
    for (const [id, hash] of newHashes) hashCommon.set(id, hash)
  }

  // large 下载（原图保留），收藏 12 + 日历 2
  const collLarge = largeEntries.filter((e: DownloadEntry) => !hashLarge.has(e.subjectId))
  const newCollLarge = collLarge.filter((e: DownloadEntry) => collSubjectIds.has(e.subjectId)).slice(0, 12)
  const newCalLarge = collLarge.filter((e: DownloadEntry) => !collSubjectIds.has(e.subjectId)).slice(0, 2)
  const newLarge = [...newCollLarge, ...newCalLarge]
  if (newLarge.length > 0) {
    const newHashes = await downloadImagesWithLimit(newLarge, imageStore, client)
    for (const [id, hash] of newHashes) hashLarge.set(id, hash)
  }

  console.log(JSON.stringify({
    event: 'sync_phase',
    phase: 'images_downloaded',
    common_candidates: commonEntries.length,
    large_candidates: largeEntries.length,
    old_common: hashCommon.size - newCommon.length,
    old_large: hashLarge.size - newLarge.length,
    new_common: newCommon.length,
    new_large: newLarge.length,
    at: new Date().toISOString(),
  }))

  // hashCommon 用旧 hashLarge 兜底（没下到 common 的条目暂时用旧值，逐步过渡）
  for (const [id, hash] of hashLarge) {
    if (!hashCommon.has(id)) hashCommon.set(id, hash)
  }

  // imageHashMap（传给 merge，作为 images.hash）
  const imageHashMap = hashCommon

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

  // 4. 日历 transform（rawCalendar 已在图片下载阶段 fetch）
  if (!rawCalendar) throw new Error('Calendar fetch failed; aborting sync')
  const calendar = transformCalendar(rawCalendar, imageHashMap)

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

  // 注入 images.hash_large（common 的 hash 已由 merge 写入 images.hash）
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const entry of (merged[key] || []) as any[]) {
      entry.images.hash_large = hashLarge.get(entry.subject_id as number) ?? null
    }
  }
  for (const day of calendar) {
    for (const item of (day.items || []) as any[]) {
      item.images.hash_large = hashLarge.get(item.id as number) ?? null
    }
  }

  const snapshot: SyncSnapshot = { collections: merged, calendar, meta }
  // 主快照（供 health/排障）
  await storage.put(SNAPSHOT_KEY, snapshot)
  // 按 type 拆分存储，避免每次 API 请求读 150KB+ 全量快照
  const COLLECTION_KEYS = ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const
  const summary: Record<string, number> = {}
  for (const key of COLLECTION_KEYS) {
    const list = merged[key] || []
    await storage.put(`collections:${key}`, list)
    summary[key] = list.length
  }
  summary._total = Object.values(summary).reduce((a, b) => a + b, 0)
  await storage.put('collections:summary', summary)
  await storage.put('calendar:latest', calendar)
  await storage.put(LAST_SUCCESS_KEY, new Date().toISOString())
  await storage.delete(LAST_ERROR_KEY)

  console.log(JSON.stringify({ event: 'sync_phase', phase: 'snapshot_written', generation, calendar_days: calendar.length, at: new Date().toISOString() }))
  return { merged, calendar, generation }
}
