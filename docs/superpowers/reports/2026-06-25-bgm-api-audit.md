# bgm.tv API Usage Audit

## Scope

This report audits runtime bgm.tv API calls and API claims in README/design/plan docs. Runtime findings are prioritized separately from documentation debt.

## Evidence Sources

- `docs/example/api/bgm-api.json`
- `packages/shared/src/bgm-client.ts`
- `packages/shared/src/platform/bgm.ts`
- `packages/shared/src/utils.ts`
- `packages/worker/src/cron.ts`
- `packages/worker/src/manage/oauth.ts`
- `packages/worker/src/manage/compare.ts`
- `packages/worker/src/manage/sync-write.ts`
- `README.md`
- `docs/superpowers/specs/**`
- `docs/superpowers/plans/**`

## Runtime API Inventory

| ID | Location | Runtime use | Endpoint | Method | Auth | Body/query | Parser | Caller semantics |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| INV-001 | `packages/shared/src/bgm-client.ts` | `getCollections()` | `/v0/users/{username}/collections` | GET | Optional Bearer via `this.headers()` | `subject_type=2`, `limit`, `offset` | JSON | Fetch anime collections for cron and account compare/sync |
| INV-002 | `packages/shared/src/bgm-client.ts` | `getSubject()` | `/v0/subjects/{subject_id}` | GET | Optional Bearer via `this.headers()` | path `subjectId` | JSON, 404 -> `null` | Fetch subject detail when needed |
| INV-003 | `packages/shared/src/bgm-client.ts` | `getCalendar()` | `/calendar` | GET | Optional Bearer via `this.headers()` | none | JSON | Fetch broadcast calendar for snapshots |
| INV-004 | `packages/shared/src/bgm-client.ts` | `downloadImage()` | arbitrary image URL from bgm.tv response | GET | none | URL from API response | `arrayBuffer()` | Cache subject/calendar images |
| INV-005 | `packages/shared/src/bgm-client.ts` | `oauthAccessToken()` | `https://bgm.tv/oauth/access_token` | POST | client credentials in JSON body | `authorization_code` grant | JSON | Exchange OAuth code |
| INV-006 | `packages/shared/src/bgm-client.ts` | `refreshAccessToken()` | `https://bgm.tv/oauth/access_token` | POST | client credentials in JSON body | `refresh_token` grant | JSON | Refresh stored token |
| INV-007 | `packages/shared/src/bgm-client.ts` | `tokenStatus()` | `https://bgm.tv/oauth/token_status` | POST | token in form body | `access_token` form field | JSON with fallback states | Probe token validity |
| INV-008 | `packages/shared/src/bgm-client.ts` | `patchCollection()` | `/v0/users/-/collections/{subject_id}` | PATCH | Bearer required | sync write body | shared `fetchJson()` | Write target account collection entry |
| INV-009 | `packages/shared/src/bgm-client.ts` | `getMe()` | `/v0/me` | GET | Bearer required | none | JSON | Resolve token owner username/id |

## Findings

Findings are added after spec and documentation comparison.

## Fix Batch Proposal

The final batch proposal is added after all findings are classified.
