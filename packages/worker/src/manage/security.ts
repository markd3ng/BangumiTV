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

const safeErrorKinds = new Set([
  'BgmHttpError',
  'BgmTimeoutError',
  'BgmNetworkError',
  'SyntaxError',
  'TypeError',
  'Error',
])

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

const publicMessages: Record<string, string> = {
  BGM_AUTH: 'Upstream authorization failed',
  BGM_TIMEOUT: 'Upstream request timed out',
  BGM_UPSTREAM: 'Upstream request failed',
  INVALID_REQUEST: 'Invalid request',
}

export function publicError(status: number, code: string, _error?: unknown): Response {
  return Response.json(
    { error: { code, message: publicMessages[code] || 'Request failed' } },
    { status, headers: manageHeaders() },
  )
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
