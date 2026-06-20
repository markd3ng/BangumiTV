## Context

Worker 通过 `assets.ts` 内联一份前端，CI 又部署 `public/` 到 Pages。两份源码已经漂移，Pages HTML 还保留无效占位域名。

## Goals / Non-Goals

**Goals:**

- 只保留 Worker 作为正式页面、资源和 API origin。
- 让前端文件成为唯一源码并可在部署前验证。

**Non-Goals:**

- 不重做 Widget UI。
- 不保留无实际需求的独立 Pages 产品。

## Decisions

- 删除 GitHub Actions 中 Pages provisioning 和 deploy 步骤。
- 保留 `public/` 作为可读源码，通过 Wrangler 静态资源能力或最小构建导入交付；不再维护 `assets.ts` 大字符串副本。
- 所有默认配置使用 `window.location.origin`，外部嵌入仍允许显式 `apiUrl`。
- 使用现有工具或极小脚本检查占位符与资源语法，不新增大型构建框架。

## Risks / Trade-offs

- [旧 Pages URL 停止更新] → README 明确 Worker URL 为唯一正式入口；需要时可在 Cloudflare 侧做重定向。
- [Wrangler 资源配置调整] → dry-run 验证 bundle 和静态资源绑定。

## Migration Plan

先让 Worker 直接交付单一源码并验证，再删除 Pages CI 步骤。回滚只需恢复旧 Worker 资源交付，不依赖 Pages 数据。

## Open Questions

深度设计阶段比较 Wrangler 静态 assets 与构建期文本导入，选择文件更少的一种。
