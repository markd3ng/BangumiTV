# BangumiTV

> 在静态页面中渲染你的 Bangumi 追番进度

基于 Cloudflare Workers，数据直接来源于 bgm.tv API。条目封面在同步时自动下载，计算哈希后存入 R2 bucket，通过 `/image/:hash` 路由提供。

**架构：双 Worker 拆分** — 主 Worker (`bangumi-tv`) 处理公开 API、前端动画同步 API、图片代理；同步 Worker (`bangumi-tv-sync`) 独立处理定时同步和图片下载，各自独享 50 子请求配额，避免同步导致 API 响应超时或子请求超限。

## Demo

`https://bangumi-tv.<你的域名>.workers.dev`

## 前置条件

- [Cloudflare](https://cloudflare.com) 账号
- [bgm.tv](https://bgm.tv) 账号及 [开发者 Access Token](https://bgm.tv/dev)
- GitHub 账号

### Cloudflare API Token 权限配置

前往 [Cloudflare Dashboard → 个人资料 → API 令牌](https://dash.cloudflare.com/profile/api-tokens)，创建 API 令牌：

选择 **「编辑 Cloudflare Workers」** 模板，或手动创建自定义令牌，需勾选以下权限：

| 范围 | 权限 | 说明 |
|------|------|------|
| 账户 — Workers Scripts | 编辑 | 部署 Worker 代码 |
| 账户 — Workers KV Storage | 编辑 | 创建和管理 KV 命名空间 |
| 账户 — Workers R2 Storage | 编辑 | 创建和管理 R2 存储桶 |
| 账户 — Account Settings | 读取 | 读取账户设置（必含） |
| 用户 — User Details | 读取 | 读取用户信息（必含） |
| 区域 — Workers Routes | 编辑 | 管理 Worker 路由 |

> **提示：** 如果直接使用「编辑 Cloudflare Workers」模板，默认已包含上述所需权限。在「账户资源」中选择你的 Cloudflare 账户，「区域资源」选择「所有区域」即可。

## 快速部署

部署分两个阶段：**阶段一只需 Cloudflare 凭证**即可让 Worker 上线并拿到域名，**阶段二**再生成 token、配置 secrets 后重新部署。

### 阶段一：部署 Worker（仅需 Cloudflare 凭证）

1. Fork 本仓库

2. 配置 GitHub Secrets & Variables（此阶段只填以下几项即可，其余留到阶段二）：

   前往 Repo → Settings → Secrets and variables → Actions。

   **Secrets:**
   | 名称 | 说明 |
   |------|------|
   | `CF_API_TOKEN` | Cloudflare API Token（见上方「Cloudflare API Token 权限配置」） |
   | `CF_ACCOUNT_ID` | Cloudflare 账户 ID（Dashboard 右侧栏可见） |
   | `CRON_SECRET` | 自定义随机字符串（手动触发 sync worker `POST /__cron/sync` 认证用） |

   **Variables:**
   | 名称 | 说明 |
   |------|------|
   | `BANGUMI_USERS` | 要展示的 bgm 用户名（逗号分隔，如 `user1,user2`） |
   | `BANGUMI_PRIMARY_USER` | `primary` 模式下的主账户名（单账户可留空） |

3. Push 到 `dev` 分支：

   ```bash
   git push origin dev
   ```

   GitHub Actions 将自动：检查并创建 Cloudflare KV / R2 资源 → 构建前端 → 注入环境变量 → 部署 Worker。

4. 部署完成后，你的 Worker 访问域名为 `https://bangumi-tv.<你的子域名>.workers.dev`。此时公开 widget 已可访问，但 cron 同步尚未生效（`BANGUMI_TOKEN` 未配置）。

### 阶段二：生成 Access Token、配置 cron、触发首次同步

#### 1. 生成 bgm.tv Access Token

登录 [bgm.tv](https://bgm.tv)，前往 [开发者设置](https://bgm.tv/dev) 生成一个永久 access token（用于 cron 定时同步抓取收藏数据）。

#### 2. 配置 Cron Token

将上一步生成的 access token 配置为 sync worker 的环境变量 `BANGUMI_TOKEN`：

- **Cloudflare Dashboard**：Workers → `bangumi-tv-sync` → Settings → Secrets → 添加 `BANGUMI_TOKEN`
- **或 GitHub Secrets**：Repo → Settings → Secrets → Actions → 添加 `BANGUMI_TOKEN`（CI 自动注入）

#### 3. 触发首次同步

Token 配置完成后可立即触发一次同步：

```bash
curl -X POST -H "X-Cron-Secret: <CRON_SECRET>" https://bangumi-tv-sync.<你的子域名>.workers.dev/__cron/sync
```

> **⚠️ 首次部署后需手动创建 Cron Trigger：** 由于 Cloudflare API 对 cron schedule 的管理存在兼容性问题，sync worker 的定时触发器需手动配置一次。前往 [Cloudflare Dashboard → Workers & Pages → bangumi-tv-sync → Triggers](https://dash.cloudflare.com) → Add Cron Trigger，Cron 表达式填 `0 */4 * * *`。后续代码更新无需重新配置。

## 前端接入

在任意页面中引入 Widget：

```html
<link rel="stylesheet" href="/src/bangumi.css">
<script>
  window.bgmConfig = {
    apiUrl: window.location.origin,
    quote: "生命不止，追番不息！"
  }
</script>
<script src="/src/bangumi.js"></script>
<div class="bgm-container"></div>
```

## 图片策略

Sync Worker 在定时同步时自动下载条目封面（来源：bgm.tv），计算 SHA-256 哈希后存入 R2 bucket（`bangumi-tv-images`）。图片通过主 Worker 的 `/image/:hash` 路由按需提供。

- 每次同步最多下载 **25 张**新图片（Free Plan 50 子请求限制），其余复用上次快照中的旧 hash，跨多次同步逐步补全
- 下载限流至最多 2 个并行，单张超时 8 秒，失败不影响同步整体流程
- 前端在 hash 为 null 时使用纯色占位 SVG，避免构造损坏 URL
- 图片缓存头：`Cache-Control: public, max-age=31536000, immutable`

## 前端动画同步

访问 Worker 首页并切换到「动画同步」视图：

- **多账户动画同步**：粘贴两个 bgm.tv access token → 点击对比 → 选择完整同步动画或选中同步动画 → 执行。当前仅同步 bgm.tv 动画收藏（`subject_type=2`）。Token 在 [bgm.tv 开发者设置](https://bgm.tv/dev) 生成，永久有效。
- **Cron token** 通过 Cloudflare Dashboard 环境变量 `BANGUMI_TOKEN` 配置，不在前端页面操作。

> 说明：旧 `/manage` 页面入口和 `/api/manage/*` 同步接口已移除；首页动画同步视图调用 `POST /api/sync/compare` 和 `POST /api/sync/apply`。

## 本地开发

```bash
pnpm install
npx wrangler dev
```

Worker 启动在 `http://localhost:8787`。

> **KV 绑定：** `wrangler.toml` 中的 KV `id` 在 CI 部署时会被替换为真实 id。本地 `wrangler dev` 需先手动创建本地预览命名空间：`npx wrangler kv namespace create bangumi-tv-kv --preview`，把返回的 `preview_id` 填入 `wrangler.toml` 的 `preview_id` 字段，或直接用 `wrangler dev --local`（本地模拟，不连真实 KV）。

本地运行需要提供 secrets。在项目根目录创建 `.dev.vars` 文件：

```
BANGUMI_TOKEN=你的_access_token
BANGUMI_REFRESH_TOKEN=你的_refresh_token
BANGUMI_USERS=user1,user2
BANGUMI_PRIMARY_USER=user1
BANGUMI_CLIENT_ID=你的_client_id
BANGUMI_CLIENT_SECRET=你的_client_secret
CRON_SECRET=任意字符串
# BANGUMI_TOKEN 用于 cron 同步，通过 Cloudflare Dashboard 或 GitHub Secrets 配置
SYNC_MODE=merge
NSFW_SHOW=true
```

> `.dev.vars` 已被 `.gitignore` 忽略，不会提交。本地若需手动触发一次同步，需先启动 sync worker（`npx wrangler dev --config wrangler.sync.toml --port 8788`），然后 `curl -X POST -H "X-Cron-Secret: 任意字符串" http://localhost:8788/__cron/sync`。

## 环境变量说明

| 变量 | 类型 | 说明 |
|------|------|------|
| `SYNC_MODE` | var | `merge`（多账号取并集，相同条目以最新为准）或 `primary`（以主账号为准） |
| `NSFW_SHOW` | var | 是否展示 R18 条目（`true`/`false`）。为 `true` 时前端首次访问会弹 age-18 确认窗，R18 卡片默认模糊、点击可查看；为 `false` 时 API 直接不返回 R18 条目 |
| `BANGUMI_TOKEN` | secret | cron 同步用的 bgm.tv access token（在 [bgm.tv 开发者页面](https://bgm.tv/dev) 生成，永久有效） |
| `BANGUMI_REFRESH_TOKEN` | secret | 可选。bgm.tv refresh token（developer token 无需此字段） |
| `BANGUMI_USERS` | var | bgm 用户名列表（逗号分隔，如 `user1,user2`） |
| `BANGUMI_PRIMARY_USER` | var | `primary` 模式下的主账户名 |
| `BANGUMI_CLIENT_ID` | secret | bgm.tv API 应用的 App ID（sync worker 内部 API 调用用） |
| `BANGUMI_CLIENT_SECRET` | secret | bgm.tv API 应用的 App Secret（sync worker 内部 API 调用用） |
| `CRON_SECRET` | secret | 手动触发 sync worker `POST /__cron/sync` 的认证密钥（定时 cron 由 sync worker 自动执行） |

> GitHub 中：标 **var** 的配在 Settings → Secrets and variables → Actions → **Variables**；标 **secret** 的配在 **Secrets**。

### 迁移与回滚

- 迁移顺序：先在部署环境配置 `BANGUMI_TOKEN`，再部署代码，最后在 Worker 首页的「动画同步」视图验证多账户动画同步。
- 回滚代码时：保留 `BANGUMI_TOKEN` / `BANGUMI_REFRESH_TOKEN`，并继续保留 KV 中已有的 `bgm:tokens`；不要在回滚里清空 token，否则后续 cron 需要重新配置。

## 调试与日志

所有请求和内部操作均输出结构化 JSON 日志（`console.log` / `console.warn` / `console.error`），每条带 `event` 字段区分事件类型与 `at` 时间戳。

### 实时日志

```bash
# 开发环境
cd packages/worker && npx wrangler tail

# 生产环境
npx wrangler tail --env production
```

```bash
# 只看错误
wrangler tail | grep '"event":"api_error"'
# 只看同步阶段
wrangler tail | grep '"event":"sync_phase"'
# 慢请求（>500ms）
wrangler tail | grep '"duration_ms":[5-9][0-9][0-9]'
```

### API 端点查错

**健康检查（公开，无需认证）**

```bash
curl https://your-worker.workers.dev/api/health
# → {"ok":true,"data":{"collections":{...},"calendar":"7 days","last_sync":"...","last_error":null}}
```

`last_error` 为最近一次同步失败的错误消息（仅存最近一条）。

KV 环形缓冲区仍在内部保留最近 **50 条**错误/warn 事件，供 Worker 运行时排障使用；当前不再暴露公开错误日志查询 API。

### 日志事件速查

| event | 级别 | 含义 |
|-------|------|------|
| `request` | info | 每条 HTTP 请求，含 method / path / status / duration_ms |
| `api_collections` | info | 公开 API 收藏查询 |
| `api_calendar` | info | 公开 API 日历查询 |
| `api_config` | info | 公开 API 配置查询 |
| `api_error` | error | 公开 API 内部异常，含 `message` |
| `health_ok` | info | 健康检查成功，含 `has_snapshot` / `last_sync` / `has_error` |
| `health_failed` | error | 健康检查异常 |
| `image_proxy_hit` | info | 图片缓存命中，含 `hash` / `content_type` |
| `image_proxy_miss` | info | 图片缓存未命中，含 `hash` |
| `image_download_failed` | warn | 单图下载失败，含 `subject_id` / `url` / `reason` |
| `sync_compare` | info | 账户动画收藏对比结果，含双方条目数 / 共同数 / 差异数 |
| `sync_compare_fetch_failed` | error | 账户对比拉取收藏失败，含安全化后的 `reason` |
| `sync_apply` | info | 前端动画同步写入，含 `mode` / `total` / `ok` / `errors` |
| `sync_request_failed` | error | 前端同步 API 上游/内部错误，含 `route` / `kind` / `upstream_status` |
| `sync_phase` | info | 定时同步阶段（token_refresh → token_ready → fetched_collections → images_downloaded → fetch_calendar → snapshot_written），每阶段含计数 |
| `sync_failed` | error | 定时同步失败，含 `phase` / `kind` / `upstream_status` |
| `sync_item_failed` | warn | 单条目 PATCH 失败，含 `subject_id` / `reason` |
| `cron_sync_manual_ok` | info | 手动 cron 同步成功 |

## 感谢

- [bangumi/api](https://github.com/bangumi/api) 提供 API
- [GeeKaven/BangumiTV](https://github.com/GeeKaven/BangumiTV) 原始项目
