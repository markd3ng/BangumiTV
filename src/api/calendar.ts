import type { StorageAdapter } from '../storage/adapter'

export async function handleCalendar(storage: StorageAdapter): Promise<Response> {
  const calendar = await storage.get('calendar')
  return Response.json(calendar || [])
}
