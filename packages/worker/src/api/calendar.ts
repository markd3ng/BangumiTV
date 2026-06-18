import type { StorageAdapter } from '@bangumi-tv/shared'

export async function handleCalendar(storage: StorageAdapter, nsfwShow: boolean): Promise<Response> {
  const calendar = await storage.get<Array<{ weekday: { en: string; cn: string; ja: string; id: number }; items: Array<Record<string, unknown>> }>>('calendar')
  if (!calendar) return Response.json([])

  const filtered = calendar.map((d) => ({
    weekday: d.weekday,
    items: nsfwShow ? d.items : d.items.filter((item) => !item.nsfw),
  }))
  return Response.json(filtered)
}
