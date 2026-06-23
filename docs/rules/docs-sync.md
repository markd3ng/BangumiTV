# 文档同步与发版约束

> 规则入口：`CLAUDE.md` / `AGENTS.md`
> 此文件是完整规则正文。

## 一、提交纪律

**每次完成一个原子动作（fix / refactor / feat / chore）之后必须立即 commit 并 push，不得积攒。**

- 一条 commit 对应一个逻辑变更
- commit message 遵循 conventional commits（`feat:` / `fix:` / `refactor:` / `docs:` / `chore:`）
- commit 之后立即 `git push`

## 二、文档随代码同步更新

**任何修改了代码的 commit，如果涉及以下文档覆盖的范围，必须在同一 commit 或紧随其后的 `docs:` commit 中更新对应文档：**

| 变动类型 | 需检查的文档 |
|---------|------------|
| 新增/修改 API 端点 | README.md 端点说明、环境变量表 |
| 新增/修改环境变量 | README.md 环境变量说明 |
| 新增/修改 Worker 配置 | README.md 及相关架构文档 |
| 调试/日志/错误处理逻辑变更 | README.md 调试与日志章节 |
| 架构变更（Worker 拆分、绑定变更） | README.md + `docs/superpowers/specs/` 下对应设计文档 |
| CI/CD 流程变更 | README.md 部署说明 |

**原则：代码即文档。不允许代码实现与文档描述不一致。**

## 三、发版文档审计

**发版前必须执行完整文档审计。审计清单：**

1. **端点审计** — 遍历所有 API 路由，逐一核对 README 是否列出且描述正确
2. **环境变量审计** — 比对 `wrangler.toml` / `wrangler.*.toml` 中所有 `[vars]` 和 CI secrets 与 README 表格是否一致
3. **Worker 架构审计** — 确认所有 Worker（含多 Worker 拆分）的职责描述与实际入口文件一致
4. **日志事件审计** — 核对 README 中日志事件速查表与代码中所有 `console.log/warn/error` 的 `event` 字段一致
5. **配置审计** — 核对 README 中的配置说明与实际 TOML/CI 配置匹配
6. **禁止前瞻内容** — README 和设计文档中**不得包含尚未实现的特性描述、预留参数说明、或 "TODO/待实现" 标记**

**审计不通过不得发版。发现问题先修代码或文档，再重新审计，通过后方可发版。**

## 四、文件职责

| 文件 | 职责 |
|------|------|
| `CLAUDE.md` | 规则入口指针，指向本文件 |
| `AGENTS.md` | 同上，供 subagent 感知 |
| `docs/rules/docs-sync.md` | 本规则完整正文 |
| `README.md` | 用户面文档，发版审计主对象 |
| `docs/superpowers/specs/` | 设计文档，需与实现保持一致 |
