import type { BgmCollection } from './bgm-client'

export interface MergedEntry {
  subject_id: number
  name: string
  name_cn: string
  summary: string
  images: { hash: string; w: number; h: number }
  eps: number
  total_episodes: number
  ep_status: number
  vol_status: number
  type: number
  collection_type: number
  rate: number
  nsfw: boolean
  date: string
  tags: string[]
  updated_at: string
}

export interface MergedCollections {
  want: MergedEntry[]
  watched: MergedEntry[]
  watching: MergedEntry[]
  on_hold: MergedEntry[]
  dropped: MergedEntry[]
  updated_at: string
}

const TYPE_MAP: Record<number, 'want' | 'watched' | 'watching' | 'on_hold' | 'dropped'> = {
  1: 'want',
  2: 'watched',
  3: 'watching',
  4: 'on_hold',
  5: 'dropped',
}

function toTimestamp(s: string | undefined): number {
  if (!s) return 0
  const t = new Date(s).getTime()
  return Number.isNaN(t) ? 0 : t
}

function toMergedEntry(c: BgmCollection): MergedEntry {
  const subj = c.subject
  return {
    subject_id: c.subject_id,
    name: subj?.name ?? '',
    name_cn: subj?.name_cn ?? '',
    summary: subj?.summary ?? '',
    images: { hash: '', w: 0, h: 0 },
    eps: subj?.eps ?? 0,
    total_episodes: subj?.total_episodes ?? 0,
    ep_status: c.ep_status,
    vol_status: c.vol_status,
    type: c.subject_type,
    collection_type: c.type,
    rate: c.rate,
    nsfw: subj?.nsfw ?? false,
    date: subj?.date ?? '',
    tags: c.tags ?? [],
    updated_at: c.updated_at,
  }
}

export function merge(usersCollections: BgmCollection[][]): MergedCollections {
  const map = new Map<number, MergedEntry>()

  for (const collections of usersCollections) {
    for (const c of collections) {
      const entry = toMergedEntry(c)
      const existing = map.get(c.subject_id)
      // 仅当新记录时间戳有效且严格大于已有记录时才替换；无效/缺失时间戳视为 0，
      // 避免因 Invalid Date 导致比较恒为 false 而无法更新，或误覆盖有效记录。
      if (!existing || toTimestamp(c.updated_at) > toTimestamp(existing.updated_at)) {
        map.set(c.subject_id, entry)
      }
    }
  }

  const result: MergedCollections = { want: [], watched: [], watching: [], on_hold: [], dropped: [], updated_at: new Date().toISOString() }
  for (const entry of map.values()) {
    const key = TYPE_MAP[entry.collection_type] ?? 'want'
    result[key].push(entry)
  }

  return result
}

export function primaryMerge(masterCollections: BgmCollection[]): MergedCollections {
  return merge([masterCollections])
}
