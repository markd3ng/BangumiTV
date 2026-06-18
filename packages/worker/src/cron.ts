import { BgmClient, type BgmSlimSubject } from '@bangumi-tv/shared'
import { merge, primaryMerge, type MergedCollections, type MergedEntry } from '@bangumi-tv/shared'
import type { StorageAdapter } from '@bangumi-tv/shared'
import type { ImageStore } from './image/store'
import { fetchAllCollections } from '@bangumi-tv/shared'

const SUBJECT_CONCURRENCY = 8

/** 有界并发遍历：在不超过 `limit` 个并发的前提下依次执行任务。 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function fetchSubjects(client: BgmClient, subjectIds: number[]): Promise<Map<number, BgmSlimSubject>> {
  const entries = await mapWithConcurrency(subjectIds, SUBJECT_CONCURRENCY, async (id) => {
    try {
      const subject = await client.getSubject(id)
    return [id, subject] as const
    } catch {
      return [id, null] as const
    }
  })
  const map = new Map<number, BgmSlimSubject>()
  for (const [id, subject] of entries) {
    if (subject) map.set(id, subject)
  }
  return map
}

/** 下载原图并按内容哈希写入 R2，返回供前端使用的 { hash, w, h }（哈希为空表示拉取失败）。 */
async function cacheImage(
  client: BgmClient,
  store: ImageStore,
  imageUrl: string,
): Promise<{ hash: string; w: number; h: number }> {
  const empty = { hash: '', w: 0, h: 0 }
  if (!imageUrl) return empty

  const downloaded = await client.downloadImage(imageUrl)
  if (!downloaded) return empty

  // SHA-256 内容哈希：相同图片（不同 URL）共用一份缓存。
  const digest = await crypto.subtle.digest('SHA-256', downloaded.data)
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')

  // 若原图已存在则不重复写。
  const existing = await store.getOriginal(hash)
  if (!existing) {
    await store.putOriginal(hash, downloaded.data, downloaded.contentType)
  }

  const dims = readImageDimensions(downloaded.data, downloaded.contentType)
  return { hash, ...dims }
}

/** 读取图片宽高（仅支持 PNG/JPEG/GIF 的轻量解析；无法识别时返回 0）。 */
function readImageDimensions(
  data: ArrayBuffer,
  contentType: string,
): { w: number; h: number } {
  const bytes = new Uint8Array(data)
  try {
    if (contentType.includes('png') && bytes.length >= 24) {
      return {
        w: (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19],
        h: (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23],
      }
    }
    if (contentType.includes('jpeg')) {
      return readJpegDimensions(bytes)
    }
    if (contentType.includes('gif') && bytes.length >= 10) {
      return { w: bytes[6] | (bytes[7] << 8), h: bytes[8] | (bytes[9] << 8) }
    }
  } catch {
    // 解析失败不影响缓存，宽高留 0。
  }
  return { w: 0, h: 0 }
}

function readJpegDimensions(bytes: Uint8Array): { w: number; h: number } {
  let i = 2 // 跳过 SOI 标记
  while (i + 9 <= bytes.length) {
    if (bytes[i] !== 0xff) break
    const marker = bytes[i + 1]
    // SOF0~SOF15（不含 SOF4/SOF8/SOF12）携带尺寸。
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      const h = (bytes[i + 5] << 8) | bytes[i + 6]
      const w = (bytes[i + 7] << 8) | bytes[i + 8]
      return { w, h }
    }
    const segLen = (bytes[i + 2] << 8) | bytes[i + 3]
    i += 2 + segLen
  }
  return { w: 0, h: 0 }
}

/**
 * Token 持久化结构（存于 KV）。
 *
 * Workers 的 secret 运行时只读，无法写回刷新后的 token。因此把 token 对存进 KV：
 * 环境变量 BANGUMI_TOKEN / BANGUMI_REFRESH_TOKEN 仅作首次冷启动种子，之后以 KV 为准。
 * bgm.tv 刷新会返回新的 refresh_token，必须一并写回，否则旧 refresh_token 用一次后失效，
 * 7 天后又得人工介入。
 */
interface StoredTokens {
  access_token: string
  refresh_token: string
}

const KV_TOKEN_KEY = 'bgm:tokens'

/** token 临近过期则提前刷新的阈值（秒）。 */
const REFRESH_GRACE_SECONDS = 3600

/**
 * 取得一个有效的 access token：
 * 1. 优先用 KV 中已持久化的 token，否则用环境变量种子；
 * 2. 用 /oauth/token_status 探测有效性 + 过期时间；
 * 3. 无效或将在 1 小时内过期 → 用 refresh_token 刷新，并把新的一对 token 写回 KV；
 * 4. 全部失败则抛错。
 *
 * 用 token_status 而非请求某个用户名探测：后者无法区分 401(token 过期) 与
 * 404(用户名不存在)，会把过期 token 误判为有效，导致续期永不触发。
 */
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
  const status = await probe.tokenStatus(current.access_token)
  const nowSec = Math.floor(Date.now() / 1000)
  const needsRefresh =
    !status.valid ||
    (typeof status.expires === 'number' && status.expires - nowSec < REFRESH_GRACE_SECONDS)

  if (!needsRefresh) return current.access_token

  if (!env.BANGUMI_CLIENT_ID || !env.BANGUMI_CLIENT_SECRET || !current.refresh_token) {
    if (status.valid) return current.access_token // 有效但无法提前刷新，凑合用
    throw new Error('bgm.tv token expired and no refresh credentials configured')
  }

  const refreshed = await probe.refreshAccessToken(
    env.BANGUMI_CLIENT_ID,
    env.BANGUMI_CLIENT_SECRET,
    current.refresh_token,
  )
  await storage.put<StoredTokens>(KV_TOKEN_KEY, {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token,
  })
  return refreshed.access_token
}

/**
 * 日历响应精简：过滤 name_cn 为空的条目，并剥离 collection/rating/rank。
 * 与旧 Vercel buildCalendar 的变换保持一致。
 */
function transformCalendar(
  raw: Awaited<ReturnType<BgmClient['getCalendar']>>,
) {
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
) {
  const token = await ensureFreshToken(storage, env)
  const client = new BgmClient(token)

  if (env.BANGUMI_USERS.length === 0) {
    throw new Error('sync: BANGUMI_USERS is empty — nothing to sync')
  }

  // allSettled：单个账号失败不丢弃其余账号数据。
  const settled = await Promise.allSettled(env.BANGUMI_USERS.map((u) => fetchAllCollections(client, u)))
  const allCollections = settled.map((s, i) => {
    if (s.status === 'rejected') {
      console.warn(`sync: user ${env.BANGUMI_USERS[i]} failed:`, s.reason)
      return [] as Awaited<ReturnType<typeof fetchAllCollections>>
    }
    return s.value
  })
  // 至少要有一个账号成功；否则不覆盖 KV。
  const anySuccess = settled.some((s) => s.status === 'fulfilled')
  if (!anySuccess) throw new Error('sync: all users failed')

  let merged: MergedCollections
  if (env.SYNC_MODE === 'primary' && env.BANGUMI_PRIMARY_USER) {
    const idx = env.BANGUMI_USERS.indexOf(env.BANGUMI_PRIMARY_USER)
    if (idx === -1) throw new Error(`Primary user ${env.BANGUMI_PRIMARY_USER} not in users list`)
    merged = primaryMerge(allCollections[idx])
  } else {
    merged = merge(allCollections)
  }

  // 补充 subject 详情。
  const allIds = new Set<number>()
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const e of merged[key]) allIds.add(e.subject_id)
  }
  const subjects = await fetchSubjects(client, [...allIds])

  // 缓存图片并写入内容哈希。
  const uniqueImageUrls = new Map<string, Promise<{ hash: string; w: number; h: number }>>()
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const e of merged[key]) {
      const s = subjects.get(e.subject_id)
      if (!s) continue
      e.name = s.name
      e.name_cn = s.name_cn
      e.summary = s.summary
      e.nsfw = s.nsfw
      e.date = s.date
      e.eps = s.eps
      e.total_episodes = s.total_episodes

      const imageUrl = s.images?.large
      if (imageUrl && !uniqueImageUrls.has(imageUrl)) {
        uniqueImageUrls.set(imageUrl, cacheImage(client, imageStore, imageUrl))
      }
    }
  }
  const imageResults = new Map<string, { hash: string; w: number; h: number }>()
  await Promise.all(
    [...uniqueImageUrls.entries()].map(async ([url, p]) => {
      imageResults.set(url, await p)
    }),
  )
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const e of merged[key] as MergedEntry[]) {
      const s = subjects.get(e.subject_id)
      const url = s?.images?.large
      if (url) e.images = imageResults.get(url) ?? e.images
    }
  }

  const calendar = transformCalendar(await client.getCalendar())

  await storage.put('collections:merged', merged)
  await storage.put('calendar', calendar)

  return { merged, calendar }
}
