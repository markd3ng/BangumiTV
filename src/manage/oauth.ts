import { BgmClient } from '../sync/bgm-client'

export interface OAuthState {
  userA: string
  userB: string
  tokenA?: string
  tokenB?: string
  step: 'input' | 'authA' | 'authB' | 'ready'
}

export function generateState(userA: string, userB: string): string {
  return btoa(JSON.stringify({ userA, userB, step: 'authA' }))
}

export function parseState(state: string): OAuthState | null {
  try {
    return JSON.parse(atob(state))
  } catch {
    return null
  }
}

export function getOAuthRedirectUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    scope: '',
  })
  return `https://bgm.tv/oauth/authorize?${params.toString()}`
}

export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string; user_id: number }> {
  const client = new BgmClient()
  return client.oauthAccessToken(clientId, clientSecret, code, redirectUri)
}
