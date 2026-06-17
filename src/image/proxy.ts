import { R2ImageStore } from './store'

const CACHE_HEADERS = { 'Cache-Control': 'public, max-age=31536000, immutable' }

/**
 * 图片代理：按 content-hash 从 R2 取原图并按其真实 content-type 下发。
 *
 * 尚未接入真正的裁切/转码（需 CF Image Resizing 或 wasm）。因此 `w`/`fmt`
 * 查询参数当前为预留提示，不产生变体——避免为同一张原图按不同宽度/格式
 * 存 N 份完全相同的字节（既浪费 R2 存储，又让 `w` 参数虚假生效）。
 * 浏览器会通过 CSS/`img` 缩放显示。后续接入转码后，再在此处生成变体。
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

  const store = new R2ImageStore(env.BANGUMI_R2)
  const original = await store.getOriginal(hash)
  if (!original) {
    return new Response('Not found', { status: 404 })
  }

  return new Response(original.data, {
    headers: { ...CACHE_HEADERS, 'Content-Type': original.contentType },
  })
}
