export type OAuthPurpose = 'account-a' | 'account-b' | 'cron'

export interface OAuthStatePayload {
  v: 1
  nonce: string
  purpose: OAuthPurpose
  exp: number
}

const STATE_TTL_SECONDS = 300
const STATE_MAX_LENGTH = 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const purposes = new Set<OAuthPurpose>(['account-a', 'account-b', 'cron'])
const noncePattern = /^[A-Za-z0-9_-]{22}$/

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

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: manageHeaders() })
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
    if (!Number.isInteger(payload.exp) || payload.exp <= nowSeconds) return null

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

export async function authorizeManageRequest(
  request: Request,
  secret: string | undefined,
): Promise<Response | null> {
  if (!secret) {
    return errorResponse(503, 'MANAGE_NOT_CONFIGURED', 'Management API not configured')
  }

  const origin = request.headers.get('Origin')
  if (origin && origin !== new URL(request.url).origin) {
    return errorResponse(403, 'FORBIDDEN', 'Forbidden')
  }

  const providedSecret = request.headers.get('X-Manage-Secret')
  if (!providedSecret) {
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized')
  }

  const [providedDigest, expectedDigest] = await Promise.all([digest(providedSecret), digest(secret)])
  if (!fixedEqual(providedDigest, expectedDigest)) {
    return errorResponse(401, 'UNAUTHORIZED', 'Unauthorized')
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

export function oauthCallbackHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>OAuth Callback</title>
  </head>
  <body>
    <script>
      const params = new URLSearchParams(location.search)
      const code = params.get('code')
      const state = params.get('state')
      window.opener?.postMessage({ type: 'bgm-oauth', code, state }, location.origin)
      window.close()
    </script>
  </body>
</html>`
}
