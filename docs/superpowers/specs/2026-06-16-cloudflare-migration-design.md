# BangumiTV Cloudflare Migration Design

## Motivation

Rewrite BangumiTV to run on Cloudflare Workers + Pages, replacing the current Vercel serverless + static JSON architecture. All data comes from live bgm.tv API calls; images are cached in R2 with content-hash dedup. The frontend widget is preserved but the backend is completely rebuilt.

## Architecture Overview

```
                       Cloudflare
┌──────────────────────────────────────────────────────────┐
│                                                          │
│   Pages                          Workers                 │
│  ┌──────────┐                 ┌──────────────────┐      │
│  │ index.html│── deploy ──→  │  Pages Functions  │      │
│  │ bangumi.js│   (静态)      │  (SSR fallback)   │      │
│  │ bangumi.css│               └──────────────────┘      │
│  └──────────┘                                           │
│       │                                                  │
│       │ GET /api/collections                             │
│       │ GET /api/calendar                                │
│       │ GET /api/config?key=nsfw                         │
│       │ GET /image/:hash?w=&fmt=                         │
│       ▼                                                  │
│  ┌─────────────────────────────────────────────────┐    │
│  │                   Worker                        │    │
│  │  ┌───────────┐  ┌───────────┐  ┌────────────┐  │    │
│  │  │ API route │  │ Image proxy│  │ Cron handler│  │    │
│  │  │ (read KV) │  │ (R2 cache)│  │ (sync bgm) │  │    │
│  │  └─────┬─────┘  └─────┬─────┘  └─────┬──────┘  │    │
│  └────────┼──────────────┼──────────────┼──────────┘    │
│           │              │              │                │
│           ▼              ▼              ▼                │
│     ┌─────────┐   ┌──────────┐   ┌───────────────┐     │
│     │   KV    │   │    R2    │   │  bgm.tv API   │     │
│     │collections│  │  images  │   │  (external)   │     │
│     │calendar │   │          │   │               │     │
│     └─────────┘   └──────────┘   └───────────────┘     │
└──────────────────────────────────────────────────────────┘
```

Single Worker handles API routes, image proxy, and cron triggers. Pages deploys the static frontend widget.

## Directory Structure

```
BangumiTV/
├── wrangler.toml
├── package.json
├── workers/
│   └── index.ts               # Worker entry (Hono router)
├── src/
│   ├── api/
│   │   ├── collections.ts     # GET /api/collections
│   │   ├── calendar.ts        # GET /api/calendar
│   │   └── config.ts          # GET /api/config
│   ├── image/
│   │   ├── proxy.ts           # Image proxy route handler
│   │   └── store.ts           # R2 adapter (ImageStore interface)
│   ├── sync/
│   │   ├── cron.ts            # Cron trigger handler
│   │   ├── bgm-client.ts      # bgm.tv API client
│   │   └── merger.ts          # Multi-account merge logic
│   ├── manage/
│   │   ├── oauth.ts           # OAuth flow helpers
│   │   ├── compare.ts         # Account comparison logic
│   │   └── sync-write.ts      # Write-back sync to bgm.tv
│   └── storage/
│       ├── adapter.ts         # StorageAdapter interface
│       └── kv.ts              # Cloudflare KV implementation
├── public/
│   ├── index.html
│   └── src/
│       ├── bangumi.js
│       ├── bangumi.css
│       └── nsfw-modal.js
├── manage/
│   └── index.html             # Manage page (served by Worker, not Pages)
└── build.js
```

## API Design

All endpoints are served by the Worker. The frontend never sees bgm.tv usernames, user IDs, or tokens.

### Frontend endpoints (public, no auth)

```
GET /api/collections?type=watching&page=1&limit=24
→ { data: [...], total: 120, page: 1, types: { want: 10, watched: 80, watching: 20, on_hold: 5, dropped: 5 } }

GET /api/calendar
→ [{ weekday: { en, cn, ja, id }, items: [...] }]

GET /api/config?key=nsfw
→ { nsfw: true }
```

### Manage endpoints (OAuth session required)

```
GET  /manage                    → HTML page (served by Worker)
GET  /manage/callback           → OAuth callback, exchanges code for token
GET  /api/manage/compare        → Compare two users' collections (uses OAuth session tokens)
POST /api/manage/sync           → Execute sync
```

```
GET  /api/manage/compare?userA=<name>&userB=<name>
     → { userA: { collections: {...}, total: 120 }, userB: { ... }, common: 60 }
     Both users must complete OAuth before this returns data.

POST /api/manage/sync
     Body: { mode: "full" | "partial", from: "userA", to: "userB", subject_ids: [1,2,3] }
     → { results: [{ subject_id, status: "ok"|"error" }] }
```

### Image proxy

```
GET /image/:contentHash?w=<width>&fmt=webp|avif|jpeg
→ 302 to R2 or direct response with Cache-Control: public, max-age=31536000
```

`contentHash` = SHA256 of the original image bytes. Identical images across different bgm.tv entries share one cache entry.

### Internal endpoints

```
POST /__cron/sync   (triggered by Cron Triggers, requires secret header)
```

## KV Storage

Key structure in Cloudflare KV:

```
collections:merged    → { want: [...], watched: [...], watching: [...], on_hold: [...], dropped: [...], updated_at: "ISO" }
calendar              → [{ weekday: {...}, items: [...] }]
```

Collections value per-entry shape:
```json
{
  "subject_id": 123,
  "name": "進撃の巨人",
  "name_cn": "进击的巨人",
  "summary": "...",
  "images": { "hash": "abc123", "w": 400, "h": 600 },
  "eps": 25,
  "total_episodes": 25,
  "ep_status": 25,
  "type": 2,
  "rate": 8,
  "nsfw": false,
  "date": "2013-04-07"
}
```

Images are stored as `{ hash, w, h }` — no bgm.tv CDN URLs exposed to frontend.

## Image Proxy & R2

### Flow

```
GET /image/abc123?w=300&fmt=webp
  1. Check R2: images/abc123/w300.webp
  2. Hit → return with long cache headers
  3. Miss:
     a. Fetch R2: images/abc123/original
     b. If missing → download from bgm.tv CDN (using /v0/subjects/{id}/image?type=large)
     c. Store as images/abc123/original
     d. Resize + convert format in Worker (Cloudflare Image Resizing via `cf.image` binding or wasm sharp)
     e. Store variant images/abc123/w300.webp
     f. Return
```

**Supported variant widths**: 200, 300, 400, 600 (w1920 original preserved for future use). No height constraint — aspect ratio preserved.

### R2 directory layout

```
images/
  <contentHash>/
    original          ← raw download from bgm.tv CDN
    w200.webp
    w300.webp
    w400.webp
    w600.webp
```

### ImageStore interface

```ts
interface ImageStore {
  getOriginal(hash: string): Promise<ArrayBuffer | null>
  putOriginal(hash: string, data: ArrayBuffer, contentType: string): Promise<void>
  getVariant(hash: string, variant: string): Promise<ArrayBuffer | null>
  putVariant(hash: string, variant: string, data: ArrayBuffer): Promise<void>
}
```

Cloudflare R2 implementation lives in `src/image/store.ts`. Swapping platforms requires only implementing this interface.

## StorageAdapter Interface

Abstraction for KV (and future Redis/EdgeOne KV):

```ts
interface StorageAdapter {
  get<T>(key: string): Promise<T | null>
  put<T>(key: string, value: T, ttl?: number): Promise<void>
  delete(key: string): Promise<void>
}
```

Current implementation: Cloudflare KV. New platforms: implement this interface.

## Cron Job

### Schedule

Every 4 hours (configurable via `SYNC_INTERVAL` ENV):

### Execution flow

```
Cron → Worker /__cron/sync (validates secret header)
  1. For each user in BANGUMI_USERS:
     GET /v0/users/{user}/collections?subject_type=2
     Paginate (50 per page, 200ms delay between pages)
  2. For all unique subject_ids:
     GET /v0/subjects/{subject_id}
     Compute image content hash from images.large URL
     Trigger image cache warm (fire-and-forget, no blocking)
  3. Merge by SYNC_MODE:
     merge:    union of all users, same subject = latest updated_at wins
     primary:  BANGUMI_PRIMARY_USER data wins (write-back occurs in manage page, not cron)
  4. Write to KV: collections:merged, calendar
  5. Update metadata timestamp
```

### Stale-while-revalidate

When frontend requests `/api/collections`:
- If KV data is fresh (< 5 min old) → return directly
- If KV data is stale → return existing data immediately, fire background refresh

## Multi-Account Sync (Manage Page)

Accessible at `https://<worker-domain>/manage`. Not linked from the widget.

### Step 1: Enter usernames

Input form with two text fields for bgm.tv usernames.

### Step 2: OAuth authorization

Sequential OAuth flow per account:
- Redirect to `https://bgm.tv/oauth/authorize?client_id=...&response_type=code&redirect_uri=https://<worker>/manage/callback&state=<userA|userB>`
- Callback at `GET /manage/callback?code=xxx&state=xxx`: Worker exchanges code for access_token via `POST https://bgm.tv/oauth/access_token`
- Token held in short-lived cookie (session only, discarded after sync)
- After both accounts authorized, show collection summaries

### Step 3: Choose sync mode

**Full sync:**
- Select direction: A → B or B → A
- Source account's entire collection (all types) is written to target account
- Progress shown per-entry

**Partial sync:**
- Select direction: A → B or B → A
- Show list of common entries (same subject_id in both accounts) with current progress side-by-side
- Checkboxes: select all / individual entries
- Only sync selected entries from source → target

### Step 4: Execute

- `PATCH /v0/users/-/collections/{subject_id}` for each selected entry
- Body: `{ ep_status, vol_status, type, rate, tags, comment }`
- Real-time progress display
- Result summary when complete

## NSFW/R18 Handling

### Backend

- `NSFW_SHOW` ENV controls whether R18 entries appear in API responses
- When `NSFW_SHOW=false`: filter out entries with `nsfw: true` from collection responses
- `GET /api/config?key=nsfw` returns current setting

### Frontend

- On load, check `GET /api/config?key=nsfw`
- If nsfw === true and no `bgm-age-confirmed` in localStorage → show age-18 modal
- User confirms → set localStorage, render content
- User declines → redirect away
- NSFW entries in the rendered grid: blur overlay by default, click to reveal (configurable to disable blur)

## ENV Variables

```toml
# wrangler.toml - public vars
[vars]
SYNC_MODE = "merge"            # merge | primary
NSFW_SHOW = "true"
SYNC_INTERVAL = "4h"

# Secrets (not in git)
BANGUMI_TOKEN                  # bgm.tv OAuth access token
BANGUMI_REFRESH_TOKEN          # bgm.tv OAuth refresh token
BANGUMI_USERS                  # comma-separated bgm usernames
BANGUMI_PRIMARY_USER           # primary username for sync mode
BANGUMI_CLIENT_ID              # OAuth app client_id (for manage page)
BANGUMI_CLIENT_SECRET          # OAuth app client_secret (for manage page)
```

## bgm.tv API Usage

| Endpoint | Purpose | Auth |
|----------|---------|------|
| `GET /v0/users/{user}/collections` | Fetch user collections (paginated) | Bearer (optional for public) |
| `GET /v0/subjects/{subject_id}` | Fetch subject details + images | Bearer (optional for public) |
| `GET /v0/subjects/{subject_id}/image?type=large` | Get subject image redirect URL | Optional |
| `PATCH /v0/users/-/collections/{subject_id}` | Write-back sync | Bearer required |
| `GET /calendar` | Daily broadcast schedule | None |
| `POST /oauth/access_token` | Exchange code for token | client_id/secret |

User-Agent: `markd3ng/BangumiTV (https://github.com/markd3ng/BangumiTV)`

## File Change Summary

| Action | File |
|--------|------|
| Add | `workers/index.ts`, `src/**`, `manage/index.html`, `wrangler.toml` |
| Modify | `public/index.html`, `public/src/bangumi.js`, `public/src/bangumi.css`, `build.js`, `package.json` |
| Delete | `app.js`, `collection.js`, `api/serverless.js`, `data/*.json`, `vercel.json` |

## Frontend Widget Changes

- `apiUrl` → points to Worker domain
- API path changes: `/bangumi` → `/api/collections`, remove `/bangumi_total`, `/v2/bangumi`
- NSFW modal integrated
- NSFW entry blur overlay
- Response shape updated to match new API format
- CSS: preserve all existing styles, add `.bgm-nsfw-blur` and `.bgm-age-modal` styles
- Manage page: standalone HTML at `/manage`, served by Worker, not deployed to Pages

## Implementation Phases

### Phase 1: Core Worker + KV
- Set up wrangler.toml, KV namespace, Worker entry point (Hono)
- Implement bgm-client.ts (bgm.tv API wrapper)
- Implement cron sync: fetch collections → merge → write KV
- Implement public API endpoints: `/api/collections`, `/api/calendar`, `/api/config`
- Test with `wrangler dev`

### Phase 2: Image Proxy + R2
- Set up R2 bucket
- Implement ImageStore with R2 adapter
- Implement image proxy route: `/image/:hash`
- Integrate image caching into cron sync (fire-and-forget warm)

### Phase 3: Manage Page
- Implement OAuth flow (bgm.tv authorize → callback → token exchange)
- Implement compare endpoint
- Implement sync-write (PATCH collections)
- Build manage page HTML + JS (served by Worker)

### Phase 4: Frontend & Cleanup
- Update widget: new API paths, response shape, NSFW modal
- Update build.js if needed
- Delete old files: app.js, collection.js, api/, data/, vercel.json
- Deploy to Cloudflare Pages + Workers
