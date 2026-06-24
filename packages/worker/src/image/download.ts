import { BgmClient } from '@bangumi-tv/shared'
import type { ImageStore } from './store'

export interface DownloadEntry {
  url: string
  subjectId: number
  size?: string  // 'common' | 'large', 写入 R2 custom metadata
}

/**
 * 带并发限制的图片下载器。
 * 使用信号量模式：同时最多 `concurrency` 个 fetch 操作。
 * 每个图片超时 8s，失败静默跳过（hash 不入结果 map）。
 * 返回 subjectId → hex(SHA-256) 映射。
 */
export async function downloadImagesWithLimit(
  entries: DownloadEntry[],
  imageStore: ImageStore,
  bgmClient: BgmClient,
  concurrency: number = 2,
): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  let idx = 0
  const inFlight = new Set<Promise<void>>()

  async function worker(): Promise<void> {
    while (idx < entries.length) {
      const entry = entries[idx++]
      try {
        const timeoutMs = 8000
        const downloaded = await Promise.race([
          bgmClient.downloadImage(entry.url),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error('Image download timeout')), timeoutMs),
          ),
        ])
        if (!downloaded) continue

        // 计算 SHA-256 哈希
        const hashBuffer = await crypto.subtle.digest('SHA-256', downloaded.data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

        // 写入 R2
        await imageStore.putOriginal(hashHex, downloaded.data, downloaded.contentType, entry.size)
        result.set(entry.subjectId, hashHex)
      } catch (err) {
        console.warn(JSON.stringify({ event: 'image_download_failed', subject_id: entry.subjectId, url: entry.url, reason: err instanceof Error ? err.message : String(err), at: new Date().toISOString() }))
      }
    }
  }

  // 启动 concurrency 个工作协程
  for (let i = 0; i < concurrency; i++) {
    inFlight.add(worker())
  }
  await Promise.all(inFlight)

  return result
}
