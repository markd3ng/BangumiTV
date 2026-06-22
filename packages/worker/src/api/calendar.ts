import type { StorageAdapter } from '@bangumi-tv/shared'
import { getSnapshot } from '../storage/snapshot.ts'

export async function handleCalendar(storage: StorageAdapter, nsfwShow: boolean): Promise<Response> {
  const snapshot = await getSnapshot(storage)
  if (!snapshot) return Response.json([])

  const filtered = snapshot.calendar.map((d) => ({
    weekday: d.weekday,
    items: nsfwShow ? d.items : d.items.filter((item) => !(item as Record<string, unknown>).nsfw),
  }))
  return Response.json(filtered)
}
