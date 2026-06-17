import { BgmClient } from './bgm-client'
import { merge, primaryMerge, type MergedCollections } from './merger'
import type { StorageAdapter } from '../storage/adapter'
import { fetchAllCollections } from './utils'

async function fetchSubjects(client: BgmClient, subjectIds: number[]) {
  const map = new Map<number, Awaited<ReturnType<typeof client.getSubject>>>()
  for (const id of subjectIds) {
    const subject = await client.getSubject(id)
    if (subject) map.set(id, subject)
    await new Promise(r => setTimeout(r, 100))
  }
  return map
}

export async function runSync(
  storage: StorageAdapter,
  token: string,
  users: string[],
  primaryUser: string | undefined,
  syncMode: string,
) {
  const client = new BgmClient(token)

  const allCollections = await Promise.all(
    users.map(u => fetchAllCollections(client, u))
  )

  let merged: MergedCollections
  if (syncMode === 'primary' && primaryUser) {
    const idx = users.indexOf(primaryUser)
    if (idx === -1) throw new Error(`Primary user ${primaryUser} not in users list`)
    merged = primaryMerge(allCollections[idx])
  } else {
    merged = merge(allCollections)
  }

  const allIds = new Set<number>()
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const e of merged[key]) allIds.add(e.subject_id)
  }
  const subjects = await fetchSubjects(client, [...allIds])
  for (const key of ['want', 'watched', 'watching', 'on_hold', 'dropped'] as const) {
    for (const e of merged[key]) {
      const s = subjects.get(e.subject_id)
      if (s) {
        e.name = s.name
        e.name_cn = s.name_cn
        e.summary = s.summary
        e.nsfw = s.nsfw
        e.date = s.date
        e.eps = s.eps
        e.total_episodes = s.total_episodes
      }
    }
  }

  const calendar = await client.getCalendar()

  await storage.put('collections:merged', merged)
  await storage.put('calendar', calendar)

  return { merged, calendar }
}
