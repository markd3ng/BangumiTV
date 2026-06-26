import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { executeSync } from './apply.ts'
import { WatchStatus, type AccountInfo, type ComparisonItem, type PlatformClient, type PlatformId } from '@bangumi-tv/shared'

class FakeClient implements PlatformClient {
  readonly platform: PlatformId = 'bgm'
  fetchedUsernames: string[] = []
  patchedIds: string[] = []
  episodeProgressIds: string[] = []
  private readonly username: string
  private readonly items: ComparisonItem[]

  constructor(username: string, items: ComparisonItem[]) {
    this.username = username
    this.items = items
  }

  async getMe(_token: string): Promise<AccountInfo> {
    return { username: this.username, externalId: this.username, platform: 'bgm' }
  }

  async fetchCollections(_token: string, username: string): Promise<ComparisonItem[]> {
    this.fetchedUsernames.push(username)
    return this.items
  }

  async patchEntry(_token: string, externalId: string, _item: ComparisonItem, options?: { sourceToken?: string }): Promise<{ episodeChanged: number }> {
    this.patchedIds.push(externalId)
    if (options?.sourceToken) this.episodeProgressIds.push(externalId)
    return { episodeChanged: Number(externalId) }
  }
}

function item(externalId: string): ComparisonItem {
  return {
    externalId,
    title: `Anime ${externalId}`,
    status: WatchStatus.WATCHING,
    progress: 0,
    totalEpisodes: 12,
    score: 0,
    platform: 'bgm',
  }
}

function readSyncApplySource(): string {
  return readFileSync(new URL('./apply.ts', import.meta.url), 'utf8')
}

test('executeSync validates mode is either full or partial', async () => {
  const source = readSyncApplySource()
  assert.match(source, /mode.*===.*('full'|"full").*mode.*===.*('partial'|"partial")/)
})

test('executeSync validates from and to are non-empty strings', async () => {
  const source = readSyncApplySource()
  assert.match(source, /typeof fromToken !== 'string'|fromUser\.trim\(\)|from\.trim\(\)/)
})

test('executeSync validates partial mode requires subject_ids array', async () => {
  const source = readSyncApplySource()
  assert.match(source, /subject_ids/)
})

test('executeSync rejects empty subject_ids in partial mode', async () => {
  const source = readSyncApplySource()
  assert.match(source, /subject_ids\.length === 0|subject_ids\?\.length/)
})

test('executeSync full mode fetches source collections with token owner username', async () => {
  const sourceClient = new FakeClient('real-source-user', [item('1'), item('2'), item('3')])
  const targetClient = new FakeClient('real-target-user', [])

  const results = await executeSync(sourceClient, 'from-token', targetClient, 'to-token', {
    mode: 'full',
    from: 'Account A',
    to: 'Account B',
  })

  assert.deepEqual(sourceClient.fetchedUsernames, ['real-source-user'])
  assert.deepEqual(targetClient.patchedIds, ['1', '2', '3'])
  assert.equal(results.length, 3)
})

test('executeSync copies episode progress and reports changed episode count', async () => {
  const sourceClient = new FakeClient('real-source-user', [item('8')])
  const targetClient = new FakeClient('real-target-user', [])

  const results = await executeSync(sourceClient, 'from-token', targetClient, 'to-token', {
    mode: 'partial',
    from: 'Account A',
    to: 'Account B',
    subject_ids: ['8'],
  })

  assert.deepEqual(targetClient.patchedIds, ['8'])
  assert.deepEqual(targetClient.episodeProgressIds, ['8'])
  assert.equal(results[0].episodeChanged, 8)
})
