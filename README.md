# BangumiTV

> 在静态页面中渲染你的 Bangumi 追番进度

基于 Cloudflare Workers + Pages，数据直接来源于 bgm.tv API，条目图片通过 R2 缓存分发。

## Demo

`https://bangumi-tv.<你的域名>.workers.dev`

## 前置条件

- [Cloudflare](https://cloudflare.com) 账号
- [bgm.tv](https://bgm.tv) 账号及 [OAuth App](https://bgm.tv/dev/app)（用于管理页面的多账户同步）
- GitHub 账号

## 快速部署

### 1. Fork 本仓库

### 2. 配置 GitHub Secrets & Variables

前往 Repo → Settings → Secrets and variables → Actions，添加：

**Secrets:**
| 名称 | 说明 |
|------|------|
| `CF_API_TOKEN` | Cloudflare API Token（需 Workers/R2/KV 权限） |
| `CF_ACCOUNT_ID` | Cloudflare 账户 ID |
| `BANGUMI_TOKEN` | bgm.tv OAuth access token |
| `BANGUMI_REFRESH_TOKEN` | bgm.tv OAuth refresh token |
| `BANGUMI_CLIENT_ID` | bgm.tv OAuth App client_id |
| `BANGUMI_CLIENT_SECRET` | bgm.tv OAuth App client_secret |
| `CRON_SECRET` | 自定义随机字符串（用于 cron 同步认证） |

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

## 环境变量说明

| 变量 | 类型 | 说明 |
|------|------|------|
| `SYNC_MODE` | var | `merge` 或 `primary` |
| `NSFW_SHOW` | var | 是否展示 R18 条目（`true`/`false`） |
| `BANGUMI_TOKEN` | secret | bgm.tv access token |
| `BANGUMI_REFRESH_TOKEN` | secret | bgm.tv refresh token |
| `BANGUMI_USERS` | secret | bgm 用户名列表 |
| `BANGUMI_PRIMARY_USER` | secret | 主账户名 |
| `BANGUMI_CLIENT_ID` | secret | OAuth App client_id |
| `BANGUMI_CLIENT_SECRET` | secret | OAuth App client_secret |
| `CRON_SECRET` | secret | cron 同步认证密钥 |

## 感谢

- [bangumi/api](https://github.com/bangumi/api) 提供 API
- [GeeKaven/BangumiTV](https://github.com/GeeKaven/BangumiTV) 原始项目
