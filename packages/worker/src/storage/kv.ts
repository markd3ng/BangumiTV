import type { StorageAdapter } from '@bangumi-tv/shared'

export class KVStorage implements StorageAdapter {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string, validate?: (value: unknown) => value is T): Promise<T | null> {
    const raw = await this.kv.get(key, 'json')
    if (raw === null || raw === undefined) return null
    if (validate) return validate(raw) ? raw : null
    return raw as T | null
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.kv.put(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key)
  }
}
