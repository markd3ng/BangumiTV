export function handleConfig(url: URL, env: Record<string, string>): Response {
  const key = url.searchParams.get('key')
  if (key === 'nsfw') return Response.json({ nsfw: env.NSFW_SHOW === 'true' })
  return Response.json({ error: 'unknown key' }, { status: 400 })
}
