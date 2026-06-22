import { BgmClient } from '@bangumi-tv/shared'

export function getOAuthRedirectUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
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
