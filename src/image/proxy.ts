import { R2ImageStore } from './store'

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' }
const VALID_WIDTHS = [200, 300, 400, 600]
const VALID_FORMATS = ['webp', 'avif', 'jpeg', 'png']

/**
 * 图片代理。
 *
 * 当前实现尚未接入真正的裁切/转码（Worker 内 wasm 或 CF Image Resizing），
 * 因此「变体」直接复用原图字节，但严格保证：
 *  1. content-type 与实际字节一致（避免 webp 标签下发 jpeg 字节）；
 *  2. 只在缺失时才写入变体，不为同一格式重复写 R2；
 *  3. 仅对合法的 width/fmt 落地变体键，非法值归一为 w300/webp。
 */
export async function handleImage(
  env: { BANGUMI_R2: R2Bucket },
  request: Request,
): Promise<Response> {
  const url = new URL(request.url)

  const hash = url.pathname.split('/')[2]
  if (!hash || hash.length !== 64) {
    return new Response('Invalid hash', { status: 400 })
  }

  const requestedWidth = parseInt(url.searchParams.get('w') || '300', 10)
  const requestedFmt = url.searchParams.get('fmt') || 'webp'
  const width = VALID_WIDTHS.includes(requestedWidth) ? requestedWidth : 300
  const fmt = VALID_FORMATS.includes(requestedFmt) ? requestedFmt : 'webp'
  const variant = `w${width}.${fmt}`

  const store = new R2ImageStore(env.BANGUMI_R2)

  // 1. 命中变体缓存：直接返回。
  const cached = await store.getVariant(hash, variant)
  if (cached) {
    return new Response(cached.data, {
      headers: { ...CACHE_HEADERS, 'Content-Type': cached.contentType },
    })
  }

  // 2. 取原图。
  const original = await store.getOriginal(hash)
  if (!original) {
    return new Response('Not found', { status: 404 })
  }

  // 3. 暂无转码能力：用原图字节充当变体，但 content-type 与字节一致。
  //    仅在变体不存在时写入一次，避免重复 R2 写。
  await store.putVariant(hash, variant, original.data, original.contentType)
  return new Response(original.data, {
    headers: { ...CACHE_HEADERS, 'Content-Type': original.contentType },
  })
}
