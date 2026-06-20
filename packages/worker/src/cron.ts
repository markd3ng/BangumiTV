import { BgmClient } from '@bangumi-tv/shared'
import { merge, primaryMerge, type MergedCollections } from '@bangumi-tv/shared'
import type { StorageAdapter } from '@bangumi-tv/shared'
import { fetchAllCollections } from '@bangumi-tv/shared'
import { createSyncFailureLog } from './manage/security'

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
  _imageStore: unknown,
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
      const log = createSyncFailureLog('account', s.reason)
      console.warn(JSON.stringify(log))
      return [] as Awaited<ReturnType<typeof fetchAllCollections>>
    }
    return s.value
  })
  // 至少要有一个账号成功；否则不覆盖 KV。
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

  let merged: MergedCollections
  if (env.SYNC_MODE === 'primary' && env.BANGUMI_PRIMARY_USER) {
    const idx = env.BANGUMI_USERS.indexOf(env.BANGUMI_PRIMARY_USER)
    if (idx === -1) throw new Error(`Primary user ${env.BANGUMI_PRIMARY_USER} not in users list`)
    merged = primaryMerge(allCollections[idx])
  } else {
    merged = merge(allCollections)
  }

  // subject 详情（name/nsfw/eps/images）已由收藏接口内嵌在每条数据的 subject 字段中，
  // toMergedEntry 已从 c.subject 填充，无需独立 getSubject 调用。图片 hash 在后续 R2 管线
  // 就绪后再填充。

  const calendar = transformCalendar(await client.getCalendar())

  await storage.put('collections:merged', merged)
  await storage.put('calendar', calendar)

  return { merged, calendar }
}
