export interface ImageStore {
  getOriginal(hash: string): Promise<ArrayBuffer | null>
  putOriginal(hash: string, data: ArrayBuffer, contentType: string): Promise<void>
  getVariant(hash: string, variant: string): Promise<ArrayBuffer | null>
  putVariant(hash: string, variant: string, data: ArrayBuffer): Promise<void>
}

export class R2ImageStore implements ImageStore {
  constructor(private r2: R2Bucket) {}

  private key(hash: string, file: string): string {
    return `images/${hash}/${file}`
  }

  async getOriginal(hash: string): Promise<ArrayBuffer | null> {
    const obj = await this.r2.get(this.key(hash, 'original'))
    return obj ? obj.arrayBuffer() : null
  }

  async putOriginal(hash: string, data: ArrayBuffer, contentType: string): Promise<void> {
    await this.r2.put(this.key(hash, 'original'), data, {
      httpMetadata: { contentType },
    })
  }

  async getVariant(hash: string, variant: string): Promise<ArrayBuffer | null> {
    const obj = await this.r2.get(this.key(hash, variant))
    return obj ? obj.arrayBuffer() : null
  }

  async putVariant(hash: string, variant: string, data: ArrayBuffer): Promise<void> {
    await this.r2.put(this.key(hash, variant), data, {
      httpMetadata: { contentType: 'image/webp' },
    })
  }
}
