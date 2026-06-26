export type PlatformId = 'bgm'

export enum WatchStatus {
  WATCHING = 'watching',
  COMPLETED = 'completed',
  PLAN_TO_WATCH = 'plan_to_watch',
  ON_HOLD = 'on_hold',
  DROPPED = 'dropped',
}

export interface ComparisonItem {
  externalId: string
  title: string
  status: WatchStatus
  progress: number
  totalEpisodes: number
  score: number
  platform: PlatformId
}

export interface PatchEntryOptions {
  sourceToken?: string
}

export interface PatchEntryResult {
  episodeChanged: number
  episodeProgress?: {
    before: number
    after: number
    total: number
  }
}

export interface AccountInfo {
  username: string
  externalId: string
  platform: PlatformId
}

export interface PlatformClient {
  readonly platform: PlatformId
  getMe(token: string): Promise<AccountInfo>
  fetchCollections(token: string, username: string): Promise<ComparisonItem[]>
  patchEntry(token: string, externalId: string, item: ComparisonItem, options?: PatchEntryOptions): Promise<PatchEntryResult>
}
