import { R2ImageStore } from './store'

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' }

export async function handleImage(
  env: { BANGUMI_R2: R2Bucket; BANGUMI_TOKEN?: string },
  request: Request
): Promise<Response> {
  const url = new URL(request.url)

  // /image/:hash?w=300&fmt=webp
  const hash = url.pathname.split('/')[2]
  if (!hash || hash.length !== 64) {
    return new Response('Invalid hash', { status: 400 })
  }

  const width = parseInt(url.searchParams.get('w') || '300')
  const fmt = url.searchParams.get('fmt') || 'webp'
  const variant = `w${width}.${fmt}`
  const validWidths = [200, 300, 400, 600]
  const w = validWidths.includes(width) ? width : 300

  const store = new R2ImageStore(env.BANGUMI_R2)

  // 1. 查变体
  const variantData = await store.getVariant(hash, variant)
  if (variantData) {
    return new Response(variantData, { headers: { ...CACHE_HEADERS, 'Content-Type': `image/${fmt}` } })
  }

  // 2. 查原图
  let original = await store.getOriginal(hash)
  if (!original) {
    return new Response('Not found', { status: 404 })
  }

  // 3. 生成变体（简化版：先用原图返回，后续可接 CF Image Resizing）
  await store.putVariant(hash, variant, original)
  return new Response(original, { headers: { ...CACHE_HEADERS, 'Content-Type': 'image/jpeg' } })
}
