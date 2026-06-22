// SyncLock Durable Object — 全局同步互斥锁。
// 唯一实例，通过 DO idFromName('sync-lock-global') 寻址。

const DEFAULT_TTL_SECONDS = 300 // 5 分钟

export interface AcquireResponse {
  acquired: boolean
}

export class SyncLock {
  private locked = false
  private expiresAt = 0
  private storage: DurableObjectStorage
  private alarmScheduled = false

  constructor(ctx: DurableObjectState) {
    this.storage = ctx.storage
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/acquire') {
      const ttlSeconds = parseInt(url.searchParams.get('ttl') ?? String(DEFAULT_TTL_SECONDS), 10)
      const safeTtl = Number.isNaN(ttlSeconds) || ttlSeconds < 1 ? DEFAULT_TTL_SECONDS : ttlSeconds
      return this.handleAcquire(safeTtl)
    }

    if (url.pathname === '/release') {
      return this.handleRelease()
    }

    return new Response('Not Found', { status: 404 })
  }

  /** Alarm 超时自动释放锁。 */
  async alarm(): Promise<void> {
    this.locked = false
    this.expiresAt = 0
    this.alarmScheduled = false
  }

  private async handleAcquire(ttlSeconds: number): Promise<Response> {
    const now = Date.now()

    // 已锁且未过期 → 拒绝
    if (this.locked && now < this.expiresAt) {
      return Response.json({ acquired: false } satisfies AcquireResponse)
    }

    // 无锁 / 锁已过期 → 加锁
    this.locked = true
    this.expiresAt = now + ttlSeconds * 1000
    if (!this.alarmScheduled) {
      await this.storage.setAlarm(now + ttlSeconds * 1000)
      this.alarmScheduled = true
    }
    return Response.json({ acquired: true } satisfies AcquireResponse)
  }

  private async handleRelease(): Promise<Response> {
    this.locked = false
    this.expiresAt = 0
    if (this.alarmScheduled) {
      await this.storage.deleteAlarm()
      this.alarmScheduled = false
    }
    return new Response('OK', { status: 200 })
  }
}

/** 获取 SyncLock DO stub 的辅助函数。 */
export function getSyncLockStub(env: { SYNCLOCK: DurableObjectNamespace }): DurableObjectStub {
  const id = env.SYNCLOCK.idFromName('sync-lock-global')
  return env.SYNCLOCK.get(id)
}
