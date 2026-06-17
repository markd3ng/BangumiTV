const BGM_BASE = 'https://api.bgm.tv'
const UA = 'markd3ng/BangumiTV (https://github.com/markd3ng/BangumiTV)'

export class BgmHttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
    this.name = 'BgmHttpError'
  }
}

export interface BgmCollection {
  subject_id: number
  subject_type: number
  rate: number
  type: number
  comment: string
  tags: string[]
  ep_status: number
  vol_status: number
  updated_at: string
  private: boolean
  subject?: BgmSlimSubject
}

export interface BgmSlimSubject {
  id: number
  type: number
  name: string
  name_cn: string
  summary: string
  nsfw: boolean
  date: string
  eps: number
  total_episodes: number
  images: { large: string; common: string; medium: string; small: string; grid: string }
  rating: { score: number; rank: number; total: number }
}

export interface BgmCalendarItem {
  weekday: { en: string; cn: string; ja: string; id: number }
  items: BgmSlimSubject[]
}

export class BgmClient {
  constructor(private token?: string) {}

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'User-Agent': UA }
    if (this.token) h['Authorization'] = `Bearer ${this.token}`
    return h
  }

  async getCollections(username: string, offset = 0, limit = 50): Promise<{ data: BgmCollection[]; total: number }> {
    const url = `${BGM_BASE}/v0/users/${username}/collections?subject_type=2&limit=${limit}&offset=${offset}`
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new BgmHttpError(res.status, `bgm.tv collections error: ${res.status}`)
    return res.json()
  }

  async getSubject(subjectId: number): Promise<BgmSlimSubject | null> {
    const url = `${BGM_BASE}/v0/subjects/${subjectId}`
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(30000) })
    if (res.status === 404) return null
    if (!res.ok) throw new BgmHttpError(res.status, `bgm.tv subject error: ${res.status}`)
    return res.json()
  }

  async getCalendar(): Promise<BgmCalendarItem[]> {
    const url = `${BGM_BASE}/calendar`
    const res = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(30000) })
    if (!res.ok) throw new BgmHttpError(res.status, `bgm.tv calendar error: ${res.status}`)
    return res.json()
  }

  async downloadImage(url: string): Promise<{ data: ArrayBuffer; contentType: string } | null> {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
    if (!res.ok) return null
    return {
      data: await res.arrayBuffer(),
      contentType: res.headers.get('content-type') || 'image/jpeg',
    }
  }

  async oauthAccessToken(clientId: string, clientSecret: string, code: string, redirectUri: string) {
    const res = await fetch(`https://bgm.tv/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: clientId,
        client_secret: clientSecret,
        code,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new BgmHttpError(res.status, `oauth error: ${res.status}`)
    return res.json() as Promise<{ access_token: string; refresh_token: string; user_id: number }>
  }

  async refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<{ access_token: string; refresh_token: string; user_id: number }> {
    const res = await fetch(`https://bgm.tv/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': UA },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
      }),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new BgmHttpError(res.status, `oauth refresh error: ${res.status}`)
    return res.json() as Promise<{ access_token: string; refresh_token: string; user_id: number }>
  }

  /**
   * 查询 access token 状态（POST /oauth/token_status）。
   * 返回 token 是否有效及其过期 unix 时间戳；无效时 valid=false。
   * 这是唯一能可靠区分「token 过期(401)」与「资源不存在(404)」的探测方式。
   */
  async tokenStatus(token: string): Promise<{ valid: boolean; expires?: number }> {
    const res = await fetch(`https://bgm.tv/oauth/token_status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
      body: new URLSearchParams({ access_token: token }).toString(),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) return { valid: false }
    try {
      const data = (await res.json()) as { expires?: number }
      return { valid: true, expires: data.expires }
    } catch {
      return { valid: false }
    }
  }

  async patchCollection(token: string, subjectId: number, body: Record<string, unknown>) {
    const url = `${BGM_BASE}/v0/users/-/collections/${subjectId}`
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': UA },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    })
    if (!res.ok) throw new Error(`patch collection error: ${res.status}`)
    return res.json()
  }
}
