# BangumiTV

> 在静态页面中渲染你的 Bangumi 追番进度

基于 Cloudflare Workers + Pages，数据直接来源于 bgm.tv API，条目图片通过 R2 缓存分发。

## Demo

`https://bangumi-tv.<你的域名>.workers.dev`

## 前置条件

- [Cloudflare](https://cloudflare.com) 账号
- [bgm.tv](https://bgm.tv) 账号及 [OAuth App](https://bgm.tv/dev/app)（用于管理页面的多账户同步）
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

> **关于 OAuth 回调地址的鸡生蛋问题**：注册 bgm.tv OAuth App 和换取 cron token 都需要 `redirect_uri`（= Worker 域名），但 Worker 域名要部署后才有。因此部署分两个阶段：**阶段一只需 Cloudflare 凭证**即可让 Worker 上线并拿到域名，**阶段二**再注册 OAuth App、换取 token、回填剩余 secrets 后重新部署。

### 阶段一：部署 Worker（仅需 Cloudflare 凭证）

1. Fork 本仓库

2. 配置 GitHub Secrets & Variables（此阶段只填以下几项即可，其余留到阶段二）：

   前往 Repo → Settings → Secrets and variables → Actions。

   **Secrets:**
   | 名称 | 说明 |
   |------|------|
   | `CF_API_TOKEN` | Cloudflare API Token（见上方「Cloudflare API Token 权限配置」） |
   | `CF_ACCOUNT_ID` | Cloudflare 账户 ID（Dashboard 右侧栏可见） |
   | `CRON_SECRET` | 自定义随机字符串（手动触发 `POST /__cron/sync` 认证用） |

   **Variables:**
   | 名称 | 说明 |
   |------|------|
   | `BANGUMI_USERS` | 要展示的 bgm 用户名（逗号分隔，如 `user1,user2`） |
   | `BANGUMI_PRIMARY_USER` | `primary` 模式下的主账户名（单账户可留空） |

3. Push 到 `dev` 分支：

   ```bash
   git push origin dev
   ```

   GitHub Actions 将自动：检查并创建 Cloudflare KV / R2 资源 → 构建前端 → 注入环境变量 → 部署 Worker 和 Pages。

4. 部署完成后，到 Cloudflare Dashboard → Workers & Pages 找到 `bangumi-tv` 项目，记下它的访问域名（形如 `https://bangumi-tv.<你的子域名>.workers.dev`，下文记作 `WORKER_DOMAIN`）。此时公开 widget 已可访问，但 cron 同步尚未生效（token 未配置）。

### 阶段二：注册 OAuth App、换取 cron token、回填并重新部署

#### 1. 注册 bgm.tv OAuth App

登录 [bgm.tv](https://bgm.tv)，前往 [https://bgm.tv/dev/app](https://bgm.tv/dev/app) 创建应用：

- **应用名称**：自定义，如 `BangumiTV`
- **回调地址 (redirect_uri)**：填 `https://<WORKER_DOMAIN>/manage/callback`
- **应用描述**：可选

创建后记录 **App ID**（= `BANGUMI_CLIENT_ID`）和 **App Secret**（= `BANGUMI_CLIENT_SECRET`）。

> 回调地址必须与创建时一致。本地调试可额外用 `http://localhost:8787/manage/callback`（bgm.tv 支持多个回调地址时；若只允许一个，请以线上域名为准）。

#### 2. 配置 OAuth 凭证并重新部署

在 GitHub Repo → Settings → Secrets and variables → Actions → **Secrets** 中补加：

| 名称 | 说明 |
|------|------|
| `BANGUMI_CLIENT_ID` | 上一步 OAuth App 的 App ID |
| `BANGUMI_CLIENT_SECRET` | 上一步 OAuth App 的 App Secret |

然后在 GitHub Actions 页面手动重新运行一次 Deploy 工作流（或向 `dev` 推一个空提交）。

#### 3. 在管理页面授权 cron 同步账号（一次性）

部署完成后，浏览器访问 `https://<WORKER_DOMAIN>/manage`，在顶部「Cron 同步账号授权」区域点击「授权 cron 同步账号」：

1. 弹出 bgm.tv 授权页，登录并用你要展示其追番的账号授权；
2. 授权后跳转回 `/manage/callback`，把浏览器地址栏完整的回调 URL 复制粘贴到输入框，点「确认」；
3. 页面提示「✓ 已授权并保存」即成功——token 对已写入 KV，Worker 会自动续期，**无需每 7 天人工操作**。

> **为什么不用手动配 `BANGUMI_TOKEN`？** Workers 的 secret 运行时只读，无法写回刷新后的 token；把 token 存进 KV 后，cron 在 token 过期时会自动用 refresh_token 续期并把新的一对写回 KV，形成闭环。`BANGUMI_TOKEN` / `BANGUMI_REFRESH_TOKEN` 这两个 secret 现为**可选的冷启动种子**——若你不想用管理页面授权，也可手动换一次 token 填进去作为首次种子，之后仍由 KV 接管续期。

#### 4. 触发首次同步

授权完成后可立即触发一次同步而不等 4 小时定时任务：

```bash
curl -X POST -H "X-Cron-Secret: <CRON_SECRET>" https://<WORKER_DOMAIN>/__cron/sync
```

## 前端接入

在任意页面中引入 Widget：

```html
<link rel="stylesheet" href="https://bangumi-tv.<你的域名>.workers.dev/src/bangumi.css">
<script>
  const bgmConfig = {
    apiUrl: "https://bangumi-tv.<你的域名>.workers.dev",
    quote: "生命不止，追番不息！"
  }
</script>
<script src="https://bangumi-tv.<你的域名>.workers.dev/src/bangumi.js"></script>
<div class="bgm-container"></div>
```

## 管理页面

访问 `https://<worker>/manage` 进行多账户同步：

1. 输入两个 bgm.tv 用户名
2. 依次完成 OAuth 授权
3. 选择完整同步或部分同步
4. 执行同步

## 本地开发

```bash
pnpm install
npx wrangler dev
```

Worker 启动在 `http://localhost:8787`。

本地运行需要提供 secrets（KV/R2 绑定由 `wrangler.toml` 自动接入，但环境变量需本地提供）。在项目根目录创建 `.dev.vars` 文件：

```
BANGUMI_TOKEN=你的_access_token
BANGUMI_REFRESH_TOKEN=你的_refresh_token
BANGUMI_USERS=user1,user2
BANGUMI_PRIMARY_USER=user1
BANGUMI_CLIENT_ID=你的_client_id
BANGUMI_CLIENT_SECRET=你的_client_secret
CRON_SECRET=任意字符串
SYNC_MODE=merge
NSFW_SHOW=true
```

> `.dev.vars` 已被 `.gitignore` 忽略，不会提交。本地若需手动触发一次同步，可 `curl -X POST -H "X-Cron-Secret: 任意字符串" http://localhost:8787/__cron/sync`。

## 环境变量说明

| 变量 | 类型 | 说明 |
|------|------|------|
| `SYNC_MODE` | var | `merge`（多账号取并集，相同条目以最新为准）或 `primary`（以主账号为准） |
| `NSFW_SHOW` | var | 是否展示 R18 条目（`true`/`false`）。为 `true` 时前端首次访问会弹 age-18 确认窗，R18 卡片默认模糊、点击可查看；为 `false` 时 API 直接不返回 R18 条目 |
| `BANGUMI_TOKEN` | secret | 可选。bgm.tv access token，仅作 cron 冷启动种子；推荐改用 `/manage` 页面授权（token 存 KV 自动续期） |
| `BANGUMI_REFRESH_TOKEN` | secret | 可选。bgm.tv refresh token，同上 |
| `BANGUMI_USERS` | var | bgm 用户名列表（逗号分隔，如 `user1,user2`） |
| `BANGUMI_PRIMARY_USER` | var | `primary` 模式下的主账户名 |
| `BANGUMI_CLIENT_ID` | secret | OAuth App client_id |
| `BANGUMI_CLIENT_SECRET` | secret | OAuth App client_secret |
| `CRON_SECRET` | secret | 手动触发 `POST /__cron/sync` 的认证密钥（定时 cron 无需） |

> GitHub 中：标 **var** 的配在 Settings → Secrets and variables → Actions → **Variables**；标 **secret** 的配在 **Secrets**。

## 感谢

- [bangumi/api](https://github.com/bangumi/api) 提供 API
- [GeeKaven/BangumiTV](https://github.com/GeeKaven/BangumiTV) 原始项目
