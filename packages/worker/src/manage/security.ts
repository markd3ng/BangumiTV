export type OAuthPurpose = 'account-a' | 'account-b' | 'cron'

export interface OAuthStatePayload {
  v: 1
  nonce: string
  purpose: OAuthPurpose
  exp: number
}

export interface ManageErrorLog {
  event: 'manage_request_failed'
  route: string
  kind: string
  upstream_status: number | undefined
  at: string
}

export interface HealthFailureLog {
  event: 'health_failed'
  kind: string
  at: string
}

export interface SyncFailureLog {
  event: 'sync_failed'
  phase: 'account' | 'manual' | 'scheduled'
  kind: string
  upstream_status: number | undefined
  at: string
}

export interface SyncErrorLog {
  timestamp: number
  error: string
  stage: 'token_refresh' | 'fetch_collections' | 'fetch_calendar' | 'write_snapshot' | 'lock_timeout'
}

const STATE_TTL_SECONDS = 300
const STATE_MAX_LENGTH = 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const purposes = new Set<OAuthPurpose>(['account-a', 'account-b', 'cron'])
const noncePattern = /^[A-Za-z0-9_-]{22}$/
const safeErrorKinds = new Set([
  'BgmHttpError',
  'BgmTimeoutError',
  'BgmNetworkError',
  'SyntaxError',
  'TypeError',
  'Error',
])

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }
  return value as Record<string, unknown>
}

function nonBlankString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

function safeErrorKind(err: unknown): string {
  return err instanceof Error && safeErrorKinds.has(err.name) ? err.name : 'Unknown'
}

function upstreamStatus(err: unknown): number | undefined {
  return typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    typeof (err as { status?: unknown }).status === 'number'
    ? (err as { status: number }).status
    : undefined
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function unbase64url(value: string): Uint8Array {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=')

  return Uint8Array.from(atob(padded), char => char.charCodeAt(0))
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)))
}

function fixedEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== 32 || b.length !== 32) return false

  let difference = 0
  for (let index = 0; index < 32; index += 1) {
    difference |= a[index] ^ b[index]
  }
  return difference === 0
}

async function stateKey(secret: string): Promise<CryptoKey> {
  const material = await digest(`bangumi-tv:oauth-state:v1\0${secret}`)
  return crypto.subtle.importKey('raw', material, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
}

async function signState(secret: string, payload: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.sign('HMAC', await stateKey(secret), encoder.encode(payload)))
}

const publicMessages: Record<string, string> = {
  MANAGE_NOT_CONFIGURED: 'Management API not configured',
  OAUTH_NOT_CONFIGURED: 'OAuth is not configured',
  UNAUTHORIZED: 'Unauthorized',
  FORBIDDEN: 'Forbidden',
  BGM_AUTH: 'Upstream authorization failed',
  BGM_TIMEOUT: 'Upstream request timed out',
  BGM_UPSTREAM: 'Upstream request failed',
  INVALID_REQUEST: 'Invalid request',
  INVALID_OAUTH_STATE: 'Invalid OAuth state',
}

export function publicError(status: number, code: string, _error?: unknown): Response {
  return Response.json(
    { error: { code, message: publicMessages[code] || 'Request failed' } },
    { status, headers: manageHeaders() },
  )
}

export async function createOAuthState(
  secret: string,
  purpose: OAuthPurpose,
  now = Date.now(),
): Promise<{ state: string; nonce: string }> {
  const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)))
  const payload: OAuthStatePayload = {
    v: 1,
    nonce,
    purpose,
    exp: Math.floor(now / 1000) + STATE_TTL_SECONDS,
  }
  const encoded = base64url(encoder.encode(JSON.stringify(payload)))

  return {
    state: `${encoded}.${base64url(await signState(secret, encoded))}`,
    nonce,
  }
}

export async function verifyOAuthState(
  secret: string,
  state: string,
  now = Date.now(),
): Promise<OAuthStatePayload | null> {
  if (state.length > STATE_MAX_LENGTH) return null

  try {
    const parts = state.split('.')
    if (parts.length !== 2) return null

    const [encodedPayload, encodedSignature] = parts
    const providedSignature = unbase64url(encodedSignature)
    const expectedSignature = await signState(secret, encodedPayload)
    if (!fixedEqual(providedSignature, expectedSignature)) return null

    const payload = JSON.parse(decoder.decode(unbase64url(encodedPayload))) as Partial<OAuthStatePayload>
    const nowSeconds = Math.floor(now / 1000)

    if (payload.v !== 1) return null
    if (!noncePattern.test(payload.nonce ?? '')) return null
    if (!purposes.has(payload.purpose as OAuthPurpose)) return null
    if (
      !Number.isInteger(payload.exp) ||
      payload.exp <= nowSeconds ||
      payload.exp > nowSeconds + STATE_TTL_SECONDS
    ) return null

    return {
      v: 1,
      nonce: payload.nonce,
      purpose: payload.purpose as OAuthPurpose,
      exp: payload.exp,
    }
  } catch {
    return null
  }
}

export function parseOAuthPurposeBody(value: unknown): OAuthPurpose | null {
  const body = asRecord(value)
  if (!body) return null

  const purpose = nonBlankString(body.purpose)
  if (!purpose || !purposes.has(purpose as OAuthPurpose)) {
    return null
  }

  return purpose as OAuthPurpose
}

export function parseOAuthExchangeBody(value: unknown): { code: string; state: string } | null {
  const body = asRecord(value)
  if (!body) return null

  const code = nonBlankString(body.code)
  const state = nonBlankString(body.state)
  if (!code || !state) return null

  return { code, state }
}

export async function authorizeManageRequest(
  request: Request,
  secret: string | undefined,
): Promise<Response | null> {
  if (!secret) {
    return publicError(503, 'MANAGE_NOT_CONFIGURED')
  }

  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) {
    return publicError(403, 'FORBIDDEN')
  }

  const providedSecret = request.headers.get('X-Manage-Secret')
  if (!providedSecret) {
    return publicError(401, 'UNAUTHORIZED')
  }

  const [providedDigest, expectedDigest] = await Promise.all([digest(providedSecret), digest(secret)])
  if (!fixedEqual(providedDigest, expectedDigest)) {
    return publicError(401, 'UNAUTHORIZED')
  }

  return null
}

export function manageHeaders(csp?: string): HeadersInit {
  const headers: Record<string, string> = {
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  }

  if (csp) {
    headers['Content-Security-Policy'] = csp
  }

  return headers
}

export function managePageCsp(): string {
  return "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' https: data:; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
}

export function callbackPageCsp(): string {
  return "default-src 'none'; script-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'"
}

export function createManageErrorLog(
  route: string,
  err: unknown,
  at = new Date().toISOString(),
): ManageErrorLog {
  return {
    event: 'manage_request_failed',
    route,
    kind: safeErrorKind(err),
    upstream_status: upstreamStatus(err),
    at,
  }
}

export function createHealthFailureLog(
  err: unknown,
  at = new Date().toISOString(),
): HealthFailureLog {
  return {
    event: 'health_failed',
    kind: safeErrorKind(err),
    at,
  }
}

export function createSyncFailureLog(
  phase: SyncFailureLog['phase'],
  err: unknown,
  at = new Date().toISOString(),
): SyncFailureLog {
  return {
    event: 'sync_failed',
    phase,
    kind: safeErrorKind(err),
    upstream_status: upstreamStatus(err),
    at,
  }
}

export function oauthCallbackHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OAuth Callback</title>
  </head>
  <body>
    <p id="manual-copy" hidden>OAuth 回调已完成。请复制地址栏中的完整 URL，返回管理页手动粘贴。</p>
    <script>
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      const state = params.get('state')
      if (window.opener) {
        window.opener.postMessage({ type: 'bgm-oauth', code, state }, location.origin)
        window.close()
      } else {
        document.getElementById('manual-copy').hidden = false
      }
    </script>
  </body>
</html>`
}
