export interface StoredImage {
  data: ArrayBuffer
  contentType: string
  size?: string
  bytes?: number
}

export interface ImageStore {
  getOriginal(hash: string): Promise<StoredImage | null>
  putOriginal(hash: string, data: ArrayBuffer, contentType: string, size?: string): Promise<void>
  getVariant(hash: string, variant: string): Promise<StoredImage | null>
  putVariant(hash: string, variant: string, data: ArrayBuffer, contentType: string): Promise<void>
}

export class R2ImageStore implements ImageStore {
  constructor(private r2: R2Bucket) {}

  private key(hash: string, file: string): string {
    return `images/${hash}/${file}`
  }

  async getOriginal(hash: string): Promise<StoredImage | null> {
    const obj = await this.r2.get(this.key(hash, 'original'))
    if (!obj) return null
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || 'image/jpeg',
      size: obj.customMetadata?.size,
      bytes: obj.customMetadata?.bytes ? Number(obj.customMetadata.bytes) : undefined,
    }
  }

  async putOriginal(hash: string, data: ArrayBuffer, contentType: string, size?: string): Promise<void> {
    await this.r2.put(this.key(hash, 'original'), data, {
      httpMetadata: { contentType },
      customMetadata: size ? { size, bytes: String(data.byteLength) } : undefined,
    })
  }

  async getVariant(hash: string, variant: string): Promise<StoredImage | null> {
    const obj = await this.r2.get(this.key(hash, variant))
    if (!obj) return null
    return {
      data: await obj.arrayBuffer(),
      contentType: obj.httpMetadata?.contentType || 'image/jpeg',
    }
  }

  async putVariant(hash: string, variant: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.r2.put(this.key(hash, variant), data, {
      httpMetadata: { contentType },
    })
  }
}
