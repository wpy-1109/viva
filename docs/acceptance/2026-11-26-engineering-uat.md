# 工程验收记录

这是代理在开发环境里执行的脚本化场景，不是最终用户签字的 UAT。真人验收仍然待做。

环境：Linux x86_64，Node `v22.23.4`。`docker` 命令不存在，Compose 没有启动。macOS 与 Windows 没有运行。

## 失败与修复

1. `npx vitest run` 在实现之前：12 个测试文件失败，原因是 `ERR_MODULE_NOT_FOUND`，收集到的测试数是 0。日志 `artifacts/test-red-1.log`。补上实现后，同一轮日志 `artifacts/test-green-1.log` 为 12 个文件、42 个测试通过。
2. 新增 `tests/hook.test.ts` 后，签名正确的钩子得到 401，期望 202。日志 `artifacts/test-red-2.log`。补上 `/api/hooks/sources/:id` 和钩子密钥存储后，`artifacts/test-green-2.log` 为 2 个文件、4 个测试通过。
3. Playwright 第一次失败：`getByText('演示提供者')` 命中两个元素。第二次失败：`getByText('FTS5 trigram 词法检索')` 命中三个元素。页面当时已经给出带修订号的演示回答。把断言改成唯一文案后，`artifacts/e2e-3.log` 为 1 个测试通过。

## 最终一次完整执行

命令与结果都来自 2026-11-25 这次会话：

| 命令 | 结果 |
| --- | --- |
| `npm test` | 13 个文件、44 个测试通过。日志 `artifacts/test-final.log` |
| `npm run build` | 退出码 0。日志 `artifacts/build-final.log` |
| `bash scripts/smoke.sh` | 输出 `smoke ok`。干净目录载入演示、同步、批准、提问看到演示前缀和引用，停止后拉起 worker 再杀掉，期望状态仍是 `stopped` |
| `npx playwright test` | 2 个测试通过。日志 `artifacts/e2e-final.log` |
| `docker --version` | `docker: command not found` |

浏览器场景做了这些事：载入标明“演示数据”的手册，同步，看差异并通过对提案，用原句提问，看到“演示提供者 · 非实时模型 · FTS5 trigram 词法检索”、固定前缀和 `readme.md` 的修订号，然后启动再停止自动驾驶，刷新后仍是已停止。另一条用 390×844 视口打开来源页。截图：

- `artifacts/screenshots/01-overview.png`
- `artifacts/screenshots/02-proposal-diff.png`
- `artifacts/screenshots/03-answer.png`
- `artifacts/screenshots/04-runs-stopped.png`
- `artifacts/screenshots/05-mobile-sources.png`

源码包：`artifacts/viva-0.1.0-source.tgz`（不含 `node_modules`、`data` 和构建产物）。

## 0.1.1 这一轮

在 Node v24.22.3 上安装并运行 `@deepseek-ai/dsh@0.2.3-alpha.2`。`dsh --version` 输出 `0.2.3-alpha.2`。只读 headless 冒烟退出码 1，stdout 末行是 `MISSING_CREDENTIAL`，已存为 `tests/fixtures/dsh-headless-missing-credential.jsonl`。`VIVA_DSH_LIVE=1` 时 `tests/dsh-live.test.ts` 1 个测试通过，结果不是 completed。

修复后再跑：

| 命令 | 结果 |
| --- | --- |
| 第一次 `vitest` | 4 个文件失败：`answer.ts` 语法错误，取消后的成功被写成 cancelled 与测试假设不一致。日志 `artifacts/test-iter2.log` |
| 修复后 `vitest` | 15 个文件通过，54 个测试通过，1 个 live 测试跳过。日志 `artifacts/test-iter2c.log` |
| 浏览器 | 演示种子因相对路径返回 Internal Server Error；改成绝对路径后，反馈标题又命中两个元素。日志 `artifacts/e2e-iter2.log`、`artifacts/e2e-iter2b.log` |
| 最终 `npx playwright test` | 4 个测试通过。日志 `artifacts/e2e-iter2c.log` |

新增截图：`06-missing-credential.png`、`07-revision-diff.png`、`08-feedback-proposal.png`。

## 没有当成完成的事

- 没有真实模型密钥，所以没有现场大模型调用。演示提供者与失败路径由测试覆盖。
- 没有 GitHub 令牌下的现场仓库读取，覆盖的是夹具 fetch。
- 飞书和钉钉没有真实回调，只有合约测试。钉钉加密正文返回 501。
- DSH 只接了官方 headless 的只读 JSON 合同。没有模型密钥时冒烟停在 MISSING_CREDENTIAL。没有加载 dsh-superagent 原型。read-only 不是操作系统沙箱。
- 用户 UAT 没有人做。
