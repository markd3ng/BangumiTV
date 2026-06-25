export { BgmClient, BgmHttpError, BgmTimeoutError, BgmNetworkError } from './bgm-client'
export type { BgmCollection, BgmSlimSubject, BgmCalendarItem, TokenStatus } from './bgm-client'

export { merge, primaryMerge } from './merger'
export type { MergedEntry, MergedCollections } from './merger'

export { fetchAllCollections } from './utils'

export type { StorageAdapter } from './storage/adapter'

export { WatchStatus, BgmPlatformClient } from './platform'
export type { PlatformId, ComparisonItem, AccountInfo, PlatformClient } from './platform'
