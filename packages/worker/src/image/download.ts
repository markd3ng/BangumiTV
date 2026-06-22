import { BgmClient } from '@bangumi-tv/shared'
import type { ImageStore } from './store'

export interface DownloadEntry {
  url: string
  subjectId: number
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
        const downloaded = await bgmClient.downloadImage(entry.url)
        if (!downloaded) continue

        // 计算 SHA-256 哈希
        const hashBuffer = await crypto.subtle.digest('SHA-256', downloaded.data)
        const hashArray = Array.from(new Uint8Array(hashBuffer))
        const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')

        // 写入 R2
        await imageStore.putOriginal(hashHex, downloaded.data, downloaded.contentType)
        result.set(entry.subjectId, hashHex)
      } catch {
        // 失败静默跳过
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
