# Viva 0.1.0 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付可在本机运行的 Viva 0.1.0，完成规格中的知识闭环、持久任务、中文工作台与诚实的集成边界。

**Architecture:** Fastify 提供 API 与构建后的 React 界面，独立 worker 进程通过 SQLite WAL 认领任务。领域函数接收数据库句柄与时钟，测试不需要监听端口。DSH 只存在于不执行工具的版本探测。

**Tech Stack:** Node 22、TypeScript、Fastify、better-sqlite3、Vitest、React、Vite、Tailwind、Radix、Playwright。

## Global Constraints

- 原创代码 MIT。不复制 `deepseek-harness` 或 `dsh-superagent-prototype` 的源码。
- DSH 钉死 `@deepseek-ai/dsh@0.2.3-alpha.2`，提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`。探测命令只有 `--version`。
- superagent 原型钉死提交 `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`，执行状态保持 `pending`。
- 默认监听 `127.0.0.1:43123`。期望状态默认 `stopped`。自动发布默认关。GitHub 写接口默认关。渠道出站默认关。
- 检索响应的 `retrieval` 只能是 `fts5-trigram` 或 `like-fallback`。
- live 模型失败不得改用演示提供者。演示回答以 `【演示提供者·非实时模型】` 开头。
- 密钥不进 SQLite、API 响应、日志和默认备份。
- 不声称 macOS、Windows、Docker 已测试，除非该次命令真的跑过。
- 用户已要求在本会话直接实施，不再询问执行方式。

---

### Task 1: 工程骨架与迁移

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `src/db/migrations/001_init.sql`, `src/db/database.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces: `openDatabase(dir: string): Database`，已执行迁移并种子一个 `workspace` id `local`。

- [ ] 写迁移测试：打开临时目录得到 `local` 工作区，重复打开不重复插入迁移。
- [ ] 运行 `npx vitest run tests/db.test.ts`，确认因模块缺失失败。
- [ ] 实现迁移与 `openDatabase`。
- [ ] 再跑该测试直到通过。

### Task 2: 队列、停止与恢复

**Files:**
- Create: `src/jobs/queue.ts`, `src/control/state.ts`
- Test: `tests/queue.test.ts`

**Interfaces:**
- Produces: `enqueue`, `claim`, `succeed`, `fail`, `cancel`, `releaseOwnedLeases`, `counts`, `getDesiredState`, `setDesiredState`。
- `claim(db, { owner, now, leaseMs, limit })` 返回最多 `limit` 个任务。停止状态由调用方检查，队列本身不读期望状态。
- 失败把 `run_after` 设为 `now + 2^attempts * 1000` 毫秒，超过 `max_attempts` 则 `failed`。

- [ ] 测试幂等键、并发上限、租约过期再认领、取消、退避、停止后调用方不认领。
- [ ] 先看失败再实现。

### Task 3: 本地来源、检查点与提案

**Files:**
- Create: `src/sources/local.ts`, `src/sources/sync.ts`, `src/knowledge/publish.ts`, `src/shared/diffText.ts`
- Test: `tests/local-sync.test.ts`

**Interfaces:**
- `syncSource(db, sourceId, deps)` 写入修订与检查点，并为校验和变化入队 `knowledge.propose`。
- `publishProposal`、`rejectProposal`、`rollbackPublished`。
- 自动发布只在策略打开、种类是 `change`、差异行数不超过上限时发生。

- [ ] 测试穿越路径、超限文件、删除语义、批准、拒绝、回滚、默认不自动发布。
- [ ] 先看失败再实现。

### Task 4: 检索与模型

**Files:**
- Create: `src/knowledge/retrieve.ts`, `src/knowledge/answer.ts`, `src/model/providers.ts`
- Test: `tests/answer.test.ts`

**Interfaces:**
- `ask(db, { query, fetchImpl, now })`。
- 零命中：`abstained: true`，且 fetch 不被调用。
- demo：固定前缀。live：请求 `{baseUrl}/chat/completions`，非 2xx 抛出或返回 `error`，不得出现演示前缀。

- [ ] 测试中文 trigram、短查询 fallback、弃权、live 错误、调用上限。
- [ ] 先看失败再实现。

### Task 5: GitHub、URL 与安全抓取

**Files:**
- Create: `src/sources/github.ts`, `src/sources/url.ts`, `src/security/ssrf.ts`
- Test: `tests/github.test.ts`, `tests/ssrf.test.ts`

**Interfaces:**
- GitHub 只用 `GET /repos/{owner}/{repo}/commits/{ref}`、`/git/trees/{sha}?recursive=1`、`/contents/{path}?ref=`、`/compare/{base}...{head}`。
- `exportPullRequest` 写文件。`openPullRequest` 仅在确认短语与开关同时成立时 POST。

- [ ] 夹具测试不触网。SSRF 测试注入 DNS 解析器。
- [ ] 先看失败再实现。

### Task 6: 渠道与提示注入

**Files:**
- Create: `src/channels/feishu.ts`, `src/channels/dingtalk.ts`, `src/channels/outbound.ts`
- Test: `tests/channels.test.ts`

**Interfaces:**
- `verifyFeishu(rawBody, headers, secret, now)`、`decryptFeishu(encrypt, key)`。
- `verifyDingTalk(rawBody, headers, secret, now)`。
- `buildFeishuText`、`buildDingTalkMarkdown`、`sendIfAllowed`。
- 入站文本只创建提案。

- [ ] 官方向量、错误签名、过期时间、重复事件、出站开关、注入句子不改变 `autopublish_enabled`。
- [ ] 先看失败再实现。

### Task 7: 策略版本与 DSH 探测

**Files:**
- Create: `src/policy/prompts.ts`, `src/runtime/dshProbe.ts`
- Test: `tests/policy.test.ts`, `tests/dsh-probe.test.ts`

**Interfaces:**
- 评测用固定问答与已发布引用路径比较。低于生效版本则 `gate: "blocked"`，批准接口拒绝。
- `probeDsh({ bin, runner, nodeVersion, now })` 不使用默认的 PATH 搜索，除非 `bin` 已给出。

- [ ] 先看失败再实现。

### Task 8: HTTP、worker、备份

**Files:**
- Create: `src/server/app.ts`, `src/server/main.ts`, `src/worker/loop.ts`, `src/worker/main.ts`, `src/backup/backup.ts`
- Test: `tests/api.test.ts`, `tests/worker-restart.test.ts`, `tests/backup.test.ts`

**Interfaces:**
- 变更请求要求 cookie 或 `x-viva-token`，以及 `x-viva-request: 1`。
- Webhook 与 `/api/health` 除外。引导接口只接受回环。
- worker 循环：期望状态不是 running 时不 `claim`。启动接口才把状态改成 running，并因此允许调度补跑。

- [ ] 集成测试覆盖鉴权、同步、提问、停止后重启进程仍不认领、租约过期后第二个 worker 完成任务、备份包不含密钥。
- [ ] 先看失败再实现。

### Task 9: 中文工作台

**Files:**
- Create: `web/` 下的 Vite React 应用、`src/server` 托管 `web/dist`
- Test: `e2e/workbench.spec.ts`

**Interfaces:**
- 路由用 hash：`#/overview` `#/sources` `#/knowledge` `#/runs` `#/proposals` `#/ask` `#/settings`。
- 所有控件有可见名称。焦点可见。演示种子按钮文案含“演示数据”。

- [ ] 构建界面并用 Playwright 走完：载入演示、同步、批准提案、提问看到引用、停止自动驾驶、刷新后仍是已停止。

### Task 10: 交付文档与可重复检查

**Files:**
- Create: `README.md`, `docs/architecture.md`, `docs/api.md`, `docs/security.md`, `docs/operations.md`, `docs/quickstart.zh.md`, `.env.example`, `Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `LICENSE`, `NOTICE`
- Create after real runs: `docs/acceptance/2026-11-26-engineering-uat.md`, `artifacts/`

- [ ] `npm test`、`npm run build`、干净数据目录冒烟、worker 重启测试、浏览器场景。
- [ ] 失败则修并重跑，保留日志。不编造次数。
- [ ] Docker 仅在守护进程可用时运行；否则在验收记录里写未运行。

## 自审对照

规格 R1–R21 分别落在 Task 3–9 的测试里。R20 只在浏览器场景算完成。没有把 DSH 执行放进任何任务的完成条件。
