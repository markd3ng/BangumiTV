import type { StorageAdapter } from './adapter'

export class KVStorage implements StorageAdapter {
  constructor(private kv: KVNamespace) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.kv.get(key, 'json')
    return raw as T | null
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.kv.put(key, JSON.stringify(value))
  }

  async delete(key: string): Promise<void> {
    await this.kv.delete(key)
  }
}
