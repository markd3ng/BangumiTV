import { BgmClient } from '@bangumi-tv/shared'

export function getOAuthRedirectUrl(clientId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    state,
    // 强制 bgm.tv 显示登录页（避免前一账号的登录态复用）
    // 若 bgm.tv 不支持此参数则被忽略，无副作用
    prompt: 'login',
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
