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
| INV-008 | `packages/shared/src/bgm-client.ts` | `patchCollection()` | `/v0/users/-/collections/{subject_id}` | PATCH | Bearer required | caller body | shared `fetchJson()` | Update an existing target-account collection entry |
| INV-009 | `packages/shared/src/bgm-client.ts` | `getMe()` | `/v0/me` | GET | Bearer required | none | JSON | Resolve token owner username/id |
| INV-010 | `packages/shared/src/bgm-client.ts` | `upsertCollection()` | `/v0/users/-/collections/{subject_id}` | POST | Bearer required | sync write body | shared `fetchJson()` | Create or update target-account collection entry for account sync |

## Findings

### P0 Findings

#### BGM-API-001: `fetchJson()` treats `204 No Content` as JSON

- **Location:** `packages/shared/src/bgm-client.ts:73`, `packages/shared/src/bgm-client.ts:98`, `packages/shared/src/bgm-client.ts:198`
- **Current use:** successful write endpoints flow through `fetchJson()` and end with `res.json()`.
- **Evidence:** local OpenAPI for `POST/PATCH /v0/users/-/collections/{subject_id}` lists `204` as a successful response.
- **Impact:** successful writes can be reported as `Unexpected end of JSON input`.
- **Suggested fix:** return `undefined` or `null` for status `204`, before `res.json()`.
- **Verification:** add a shared test where `patchCollection()` receives `204` and does not throw.
- **Status:** fixed in Batch A; shared tests cover `204`.

#### BGM-API-002: account sync uses PATCH for upsert semantics

- **Location:** `packages/shared/src/bgm-client.ts:198`, `packages/shared/src/platform/bgm.ts:43`, `packages/worker/src/manage/sync-write.ts:72`
- **Current use:** sync writes call `patchCollection()` with `PATCH /v0/users/-/collections/{subject_id}`.
- **Evidence:** local OpenAPI describes `POST /v0/users/-/collections/{subject_id}` as create-or-modify. The same OpenAPI entry describes `PATCH` as modifying collection, and its 404 response includes item-not-collected semantics.
- **Impact:** syncing an item that the target account has not collected can fail with 404.
- **Suggested fix:** add a clearly named `upsertCollection()` method using `POST` and call that from `BgmPlatformClient.patchEntry()`.
- **Verification:** add a test that bgm platform sync writes use `POST`.
- **Status:** fixed in Batch A; `BgmPlatformClient.patchEntry()` now calls `upsertCollection()`.

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
- **Status:** runtime covered in Batch A; remaining stale docs are tracked as P2.

### P2 Findings

#### BGM-API-101: current audit docs incorrectly list `/calendar` as a local OpenAPI gap

- **Location:** `docs/superpowers/specs/2026-06-25-bgm-api-audit-design.md:49`, `docs/superpowers/specs/2026-06-25-bgm-api-audit-design.md:81`, `docs/superpowers/plans/2026-06-25-bgm-api-audit.md:205`, `docs/superpowers/plans/2026-06-25-bgm-api-audit.md:208`
- **Current text:** `/calendar` is grouped with OAuth `access_token` and `token_status` as not covered by local OpenAPI.
- **Evidence:** local OpenAPI contains `GET /calendar` with operationId `getCalendar`. The OAuth paths are the actual local OpenAPI gap.
- **Impact:** future audit or fix work may waste time treating `/calendar` as undocumented.
- **Suggested fix:** update active audit design/plan docs to say `/calendar` is covered, while OAuth endpoints remain outside local OpenAPI.
- **Verification:** `jq '.paths["/calendar"]' docs/example/api/bgm-api.json`.

#### BGM-API-102: historical Cloudflare design describes sync write as PATCH with book-only fields

- **Location:** `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:285`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:286`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:452`
- **Current text:** sync write uses `PATCH /v0/users/-/collections/{subject_id}` with `{ ep_status, vol_status, type, rate, tags, comment }`.
- **Evidence:** runtime findings BGM-API-002 and BGM-API-005; local OpenAPI says POST is create-or-modify and `ep_status`/`vol_status` are book-only.
- **Impact:** because this file lives under active `docs/superpowers/specs`, future implementation work can copy the stale write semantics.
- **Suggested fix:** mark this design as historical or update the API checklist to prefer POST upsert and avoid book-only fields for anime sync.
- **Verification:** `rg -n "PATCH /v0/users/-/collections|ep_status|vol_status" docs/superpowers/specs`.

#### BGM-API-103: sync docs imply full account sync while runtime fetches anime only

- **Location:** `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:272`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:274`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:235`
- **Current text:** full sync says it syncs all source-account collection status, while the API flow uses `subject_type=2`.
- **Evidence:** runtime finding BGM-API-003; local OpenAPI `SubjectType` says `2` is anime.
- **Impact:** users and future implementers may expect book/music/game/real collections to be synced.
- **Suggested fix:** choose and document either anime-only sync or all-subject sync before changing runtime behavior.
- **Verification:** `rg -n "全部收藏|subject_type=2|多账户同步" README.md docs/superpowers/specs docs/superpowers/plans`.

#### BGM-API-104: OAuth paths in docs need an explicit non-OpenAPI evidence source

- **Location:** `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:265`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:266`, `docs/superpowers/specs/2026-06-16-cloudflare-migration-design.md:454`, `docs/superpowers/plans/2026-06-22-stabilize-sync-consistency.md:206`
- **Current text:** docs mention `https://bgm.tv/oauth/authorize`, `https://bgm.tv/oauth/access_token`, and `https://bgm.tv/oauth/token_status`.
- **Evidence:** runtime finding BGM-API-004; local OpenAPI has no OAuth paths.
- **Impact:** future OAuth edits can violate the project rule requiring verified API evidence before changing calls.
- **Suggested fix:** add a local OAuth reference or cite an authoritative source before modifying these calls.
- **Verification:** `jq '.paths | keys[]' docs/example/api/bgm-api.json | rg 'oauth|token_status|access_token' || true`.

## Fix Batch Proposal

### Batch A: P0 Runtime Fixes

Status: implemented.

- Handle `204 No Content` before JSON parsing in the shared bgm client.
- Add an upsert write method using `POST /v0/users/-/collections/{subject_id}` for account sync.
- Keep `ep_status` and `vol_status` out of non-book sync write bodies.
- Add focused tests for `204`, write method, and write body.

### Batch B: P1 Product Semantics

- Decide whether account sync is anime-only or all-subject.
- If anime-only, make README/UI/report copy explicit.
- If all-subject, parameterize collection fetch by subject type and define merge behavior across subject classes before implementation.
- Keep OAuth behavior unchanged until an authoritative OAuth reference is added or cited.

### Batch C: P2 Documentation Sync

- Update the active audit design/plan docs to remove the false `/calendar` local OpenAPI gap claim.
- Update active specs that describe current API behavior with stale PATCH/write-body semantics.
- Leave old implementation plans unchanged unless they are used as current guidance.
- Add a note for OAuth endpoints not covered by `docs/example/api/bgm-api.json`.
