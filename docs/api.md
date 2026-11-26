# HTTP API

除了特别写出的路径，`/api/*` 都要本机令牌：请求头 `x-viva-token` 或 Cookie `viva_token`。除 GET、HEAD 以外还要 `x-viva-request: 1`。令牌在数据目录的 `token` 文件。

`POST /api/session/bootstrap` 只在回环地址发放 Cookie。`VIVA_DOCKER=1` 时，也允许来自 10/8、172.16/12 和 192.168/16 的连接，供 Compose 的端口映射使用。公网地址仍然拒绝。

不需要令牌的路径：

- `GET /api/health`
- `POST /api/channels/feishu/webhook`
- `POST /api/channels/dingtalk/webhook`
- `POST /api/hooks/sources/:id`，签名是原始正文的 HMAC-SHA256，十六进制，放在 `x-viva-hook-signature`

主要路径：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/overview` | 来源、已发布、待审和任务计数 |
| GET, POST | `/api/sources` | 列出来源，或添加 local / github / url |
| POST | `/api/sources/:id/sync` | 立即同步 |
| POST | `/api/sources/:id/delete` | 软删除，不删已发布知识 |
| GET | `/api/proposals` | 提案与差异 |
| POST | `/api/proposals/:id/approve` | 仅当提案基线仍等于当前已发布文本时发布。否则 409，`error` 为 `superseded`。若同时有更新的待审文本，会另生成一份以新基线为底的提案，响应含 `rebasedProposalId` |
| POST | `/api/proposals/:id/reject` | 拒绝 |
| POST | `/api/proposals/:id/rollback` | 回到上一已发布版本 |
| POST | `/api/proposals/:id/export` | 把 PR 描述写入 `exports/`。默认不调用 GitHub |
| POST | `/api/demo/seed` | 写入并同步标明“演示数据”的本地手册，返回 `{ label, sourceId, demo: true, proposals, documents }`。没有请求体 |
| POST | `/api/ask` | 请求体 `{ "query": "问题" }`。响应含 `answer`、`abstained`、`providerMode`、`retrieval`（`fts5-trigram` 或 `like-fallback`）、`citations[]`（`path`、`revisionId`、`checksum`、`snippet`）、`error` |
| POST | `/api/feedback` | 请求体 `{ "rating": "up" 或 "down", "comment": "可选", "questionId": "可选" }`。踩或评论会生成待审提案，并带上最近一条回答的路径和修订号。响应 `{ "id" }` |
| GET, POST | `/api/autopilot` 与 `/start`、`/stop` | 期望状态。停止不会被进程重启改回运行 |
| GET | `/api/jobs` | 计数、任务和事件 |
| POST | `/api/jobs/:id/cancel` | 取消等待中或进行中的任务 |
| GET, PUT | `/api/settings/model` | 模型配置。响应只有 `hasKey`，没有密钥 |
| POST | `/api/settings/model/test` | 演示模式不访问网络；真实模式返回连接错误 |
| GET, PUT | `/api/settings/channels` 与 `/api/settings/channels/:kind` | 飞书或钉钉。密钥只写 |
| POST | `/api/channels/:kind/test-outbound` | `allowOutbound` 不为真时不发送 |
| GET | `/api/runtime/dsh` | 版本探测。执行集成保持 pending |
| POST | `/api/backup` | 备份数据库，不含密钥文件 |
| GET, POST | `/api/prompts` 及 `evaluate`、`activate`、`rollback` | 提示词版本和评测门 |

GitHub 读取使用这些 REST：`GET /repos/{owner}/{repo}/commits/{ref}`、`/git/trees/{sha}?recursive=1`、`/contents/{path}?ref=`、`/compare/{base}...{head}`。打开 PR 才会 `POST /repos/{owner}/{repo}/pulls`，而且要求策略开关和确认短语同时成立。
