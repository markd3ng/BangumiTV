import type { StorageAdapter } from '@bangumi-tv/shared'

export async function handleCalendar(storage: StorageAdapter, nsfwShow: boolean): Promise<Response> {
  const calendar = await storage.get<any[]>('calendar:latest')
  if (!calendar) return Response.json([])

  const filtered = calendar.map((d: any) => ({
    weekday: d.weekday,
    items: nsfwShow ? d.items : d.items.filter((item: any) => !(item as unknown as Record<string, unknown>).nsfw),
  }))
  return Response.json(filtered)
}
