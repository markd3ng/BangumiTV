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

### P0 Findings

#### BGM-API-001: `fetchJson()` treats `204 No Content` as JSON

- **Location:** `packages/shared/src/bgm-client.ts:73`, `packages/shared/src/bgm-client.ts:98`, `packages/shared/src/bgm-client.ts:198`
- **Current use:** successful write endpoints flow through `fetchJson()` and end with `res.json()`.
- **Evidence:** local OpenAPI for `POST/PATCH /v0/users/-/collections/{subject_id}` lists `204` as a successful response.
- **Impact:** successful writes can be reported as `Unexpected end of JSON input`.
- **Suggested fix:** return `undefined` or `null` for status `204`, before `res.json()`.
- **Verification:** add a shared test where `patchCollection()` receives `204` and does not throw.

#### BGM-API-002: account sync uses PATCH for upsert semantics

- **Location:** `packages/shared/src/bgm-client.ts:198`, `packages/shared/src/platform/bgm.ts:43`, `packages/worker/src/manage/sync-write.ts:72`
- **Current use:** sync writes call `patchCollection()` with `PATCH /v0/users/-/collections/{subject_id}`.
- **Evidence:** local OpenAPI describes `POST /v0/users/-/collections/{subject_id}` as create-or-modify. The same OpenAPI entry describes `PATCH` as modifying collection, and its 404 response includes item-not-collected semantics.
- **Impact:** syncing an item that the target account has not collected can fail with 404.
- **Suggested fix:** add a clearly named `upsertCollection()` method using `POST` and call that from `BgmPlatformClient.patchEntry()`.
- **Verification:** add a test that bgm platform sync writes use `POST`.

### P1 Findings

#### BGM-API-003: account sync only fetches anime collections

- **Location:** `packages/shared/src/bgm-client.ts:101`, `packages/shared/src/platform/bgm.ts:30`, `packages/shared/src/utils.ts:6`
- **Current use:** `getCollections()` always sends `subject_type=2`.
- **Evidence:** local OpenAPI `SubjectType` says `2` is anime; other valid subject types are book, music, game, and real.
- **Impact:** if product intent is full-account sync, non-anime collections are silently excluded. If product intent is anime-only, the current implementation is correct but docs/UI must say so.
- **Suggested fix:** decide product scope. Either rename/document as anime-only, or parameterize subject type and update UI/report copy.
- **Verification:** add a test or source assertion for intended query construction after scope decision.

#### BGM-API-004: OAuth endpoints are not covered by the local OpenAPI file

- **Location:** `packages/shared/src/bgm-client.ts:135`, `packages/shared/src/bgm-client.ts:151`, `packages/shared/src/bgm-client.ts:171`, `packages/worker/src/manage/oauth.ts:3`
- **Current use:** OAuth authorize, token exchange, refresh, and token status calls use `https://bgm.tv/oauth/...`.
- **Evidence:** `jq '.paths | keys[]' docs/example/api/bgm-api.json | rg 'oauth|token_status|access_token'` returns no matches. `/calendar` is covered by local OpenAPI, but OAuth is not.
- **Impact:** project rules require verification before changing API calls; future OAuth edits need a separate authoritative evidence source.
- **Suggested fix:** before modifying OAuth behavior, add or cite a local OAuth reference for `authorize`, `access_token`, and `token_status`.
- **Verification:** keep the local OpenAPI gap command in the report or future plan.

#### BGM-API-005: `ep_status` and `vol_status` are invalid for non-book write bodies

- **Location:** `packages/shared/src/platform/bgm.ts:46`; historical docs/plans may still mention these fields for sync writes.
- **Current use:** current HEAD does not send these fields from `BgmPlatformClient.patchEntry()`.
- **Evidence:** local OpenAPI `UserSubjectCollectionModifyPayload` says both fields can only modify book progress.
- **Impact:** old deployments or docs that include these fields can trigger 400 on anime, music, game, or real subjects.
- **Suggested fix:** keep current runtime omission for anime sync; update active docs that imply these fields are general-purpose write fields.
- **Verification:** add a test that bgm platform write body excludes `ep_status` and `vol_status`.

## Fix Batch Proposal

The final batch proposal is added after all findings are classified.
