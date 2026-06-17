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

### bgm.tv OAuth App 注册

管理页面的多账户同步需要 bgm.tv OAuth App 的 `client_id` 和 `client_secret`。

1. 登录 [bgm.tv](https://bgm.tv)，前往 [https://bgm.tv/dev/app](https://bgm.tv/dev/app)
2. 点击「创建应用」，填写：
   - **应用名称**：自定义，如 `BangumiTV`
   - **回调地址 (redirect_uri)**：填 `https://<你的 Worker 域名>/manage/callback`
   - **应用描述**：可选，如 `多账户追番同步工具`
3. 创建成功后记录 **App ID**（= `BANGUMI_CLIENT_ID`）和 **App Secret**（= `BANGUMI_CLIENT_SECRET`）
4. 将这两个值填入下面的 GitHub Secrets 中

> **注意：** 回调地址必须与创建应用时填写的一致，否则 OAuth 授权会失败。如果是本地开发调试，可以先填 `http://localhost:8787/manage/callback`。

### 获取 cron 同步用的 access token / refresh token

定时同步（cron）需要一个有收藏读取权限的 `BANGUMI_TOKEN` 和 `BANGUMI_REFRESH_TOKEN`。bgm.tv 的 access token 有效期约 7 天，过期后 Worker 会用 refresh token 自动续期。首次获取这一对 token 的方法：

1. 浏览器打开（替换 `<CLIENT_ID>` 和 `<回调地址>`，与上方 OAuth App 一致）：
   ```
   https://bgm.tv/oauth/authorize?client_id=<CLIENT_ID>&response_type=code&redirect_uri=<回调地址>
   ```
2. 授权后跳转到回调地址，URL 中带 `?code=<CODE>`，复制 `<CODE>`。
3. 用 code 换取 token：
   ```bash
   curl -X POST https://bgm.tv/oauth/access_token \
     -H "Content-Type: application/json" \
     -d '{
       "grant_type":"authorization_code",
       "client_id":"<CLIENT_ID>",
       "client_secret":"<CLIENT_SECRET>",
       "code":"<CODE>",
       "redirect_uri":"<回调地址>"
     }'
   ```
4. 返回 JSON 中的 `access_token` 即 `BANGUMI_TOKEN`，`refresh_token` 即 `BANGUMI_REFRESH_TOKEN`。

## 快速部署

### 1. Fork 本仓库

### 2. 配置 GitHub Secrets & Variables

前往 Repo → Settings → Secrets and variables → Actions，添加：

**Secrets:**
| 名称 | 说明 |
|------|------|
| `CF_API_TOKEN` | Cloudflare API Token（需 Workers/R2/KV 权限） |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |
| `BANGUMI_TOKEN` | bgm.tv access token（见上方「获取 cron 同步用的 access token / refresh token」） |
| `BANGUMI_REFRESH_TOKEN` | bgm.tv refresh token（同上） |
| `BANGUMI_CLIENT_ID` | bgm.tv OAuth App client_id（见上方「bgm.tv OAuth App 注册」） |
| `BANGUMI_CLIENT_SECRET` | bgm.tv OAuth App client_secret（见上方「bgm.tv OAuth App 注册」） |
| `CRON_SECRET` | 自定义随机字符串（用于手动触发 `POST /__cron/sync` 认证；定时 cron 由 Cloudflare 调度自动运行，无需此密钥） |

**Variables:**
| 名称 | 说明 |
|------|------|
| `BANGUMI_USERS` | bgm 用户名（逗号分隔，如 `user1,user2`） |
| `BANGUMI_PRIMARY_USER` | primary 模式下的主账户名 |

### 3. Push 到 dev 分支

```bash
git push origin dev
```

GitHub Actions 将自动：
- 检查并创建 Cloudflare KV 和 R2 资源
- 构建前端
- 注入环境变量
- 部署 Worker 和 Pages

### 4. 等待部署完成

访问 `https://bangumi-tv.<你的子域名>.workers.dev`

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
| `BANGUMI_TOKEN` | secret | bgm.tv access token（见「获取 cron 同步用的 token」） |
| `BANGUMI_REFRESH_TOKEN` | secret | bgm.tv refresh token，token 过期时自动续期 |
| `BANGUMI_USERS` | var | bgm 用户名列表（逗号分隔，如 `user1,user2`） |
| `BANGUMI_PRIMARY_USER` | var | `primary` 模式下的主账户名 |
| `BANGUMI_CLIENT_ID` | secret | OAuth App client_id |
| `BANGUMI_CLIENT_SECRET` | secret | OAuth App client_secret |
| `CRON_SECRET` | secret | 手动触发 `POST /__cron/sync` 的认证密钥（定时 cron 无需） |

> GitHub 中：标 **var** 的配在 Settings → Secrets and variables → Actions → **Variables**；标 **secret** 的配在 **Secrets**。

## 感谢

- [bangumi/api](https://github.com/bangumi/api) 提供 API
- [GeeKaven/BangumiTV](https://github.com/GeeKaven/BangumiTV) 原始项目
