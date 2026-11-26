# 架构

Viva 0.1.0 是两个 Node 进程加一个 React 界面。

- `src/server` 提供 HTTP，并托管构建后的 `web/dist`。
- `src/worker` 只在期望状态为 `running` 时认领任务和做间隔调度。
- `src/db` 用 better-sqlite3 打开 `viva.sqlite`，WAL，迁移文件是 `src/db/migrations/001_init.sql`。
- 已发布片段进 `published_chunks`，FTS5 trigram 由触发器维护。短于 3 个字的查询改用 LIKE，响应里的 `retrieval` 会写成 `like-fallback`。
- 密钥在数据目录的 `secrets.json`，不在数据库里。

任务状态是 `pending`、`leased`、`succeeded`、`failed`、`cancelled`。认领使用立即事务，租约 30 秒。失败后退避 2 的尝试次数次方秒，默认 5 次后失败。停止会把本 worker 未完成的租约放回 `pending`，并且不把这次停止记成失败。

来源适配器在 `src/sources`：本地目录、GitHub REST 读取、带地址检查的 URL。同步比较已发布校验和，生成新增、过期、冲突或删除提案。自动发布默认关闭，而且只覆盖种类为 `change`、差异行数不超过上限的本地发布。GitHub 写接口还要另一个默认关闭的开关，以及请求体里的确认短语 `open-pull-request`。

模型适配器在 `src/model` 的调用路径 `src/knowledge/answer.ts`。演示提供者摘录已发布文本。真实提供者只发 OpenAI Chat Completions。零命中不调用模型。

渠道适配器在 `src/channels`。飞书实现了开放平台文档中的 SHA-256 签名和 AES-256-CBC 解密，并用官方示例向量做合约测试。钉钉实现了 `Base64(HMAC-SHA256(timestamp + "\\n" + secret))`。带 `encrypt` 字段的钉钉正文返回 501，不假装已经解密。

`src/runtime/dshProbe.ts` 记录钉死版本。只有配置了二进制路径才会执行 `--version`。版本对上时状态是 `version_matched_unvalidated`，`execution` 仍是 `pending`。

详细行为和威胁模型见 `docs/superpowers/specs/2026-11-26-viva-design.md`。
