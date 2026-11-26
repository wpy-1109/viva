# Viva 设计规格

状态：2026-11-25 自审修订后的基线。用户已授权技术与产品取舍，本文件不再把未决问题交回用户。日期文件名按交付约定使用 `2026-11-26`。

Viva（拉丁语，活着的、新鲜的）是面向个人项目与企业内部知识维护的本地优先、开源、可离线运行的知识工程工作台。它维护一条真实闭环：知识来源 → 变更发现 → 有界并行分析与更新草案 → 人工审阅与发布 → 带引用的检索回答 → 消费反馈 → 下一轮受控改进。

本版是可运行的 0.1.0 本地发行，不是企业生产认证，也不是 DeepSeek Harness 或 dsh-superagent 的换皮。

## 1. 决策记录

### 1.1 曾比较的三条路线

1. 把 DeepSeek Harness 当作进程内运行时，再加载 `dsh-superagent-prototype` 这个 bundle。
2. 从上述 MIT 仓库裁剪任务、飞书或模型模块，改名后并入 Viva。
3. Viva 自有本地运行时；只保留一个可选、只读、不执行工具的 DSH 探测适配器。

选择第 3 条。

第 1 条在本环境不能成立，也不能安全地当作默认路径：

- 已核对的钉死版本是 npm `@deepseek-ai/dsh@0.2.3-alpha.2`，对应标签 `dsh-v0.2.3-alpha.2`，提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96`（2026-11-22）。`engines.node` 为 `^24.22.3 || >=26.13.1`。本工作区实际是 Node `v22.23.4`，装得上包也启动不了官方 CLI。
- 根包是 Cordis 插件应用，含 shell、subprocess、computer-use、browser-use 与 native addon。`SAFETY.md` 写明它会执行模型生成的命令，未经安全审计，不能当作隔离边界。
- `dsh-superagent-prototype` 唯一提交是 `8c32a9dc5d72c033816c6a8110b37f40cf94fba4`（2026-10-31，DeepSeek Harness Team）。它是私有 bundle，peer 依赖 `@deepseek-ai/dsh-*@^0.2.1-alpha.2` 与 `@deepseek-ai/cordis@4.0.5-alpha.1`。当前 harness 已是 `0.2.3-alpha.2`，vendor Cordis 已到 `4.2.0-alpha.1`。版本没有对齐，不能声称兼容。
- 其 `docs/003-execution.md` 写明 Executor 以操作者的 OS 用户身份、无需批准执行命令；文中明确这些包装“establish defaults, not a security boundary”。默认交付不自合并。没有官方钉钉 Source。飞书走可选 `lark-cli`，不是本仓库可嵌入的 HTTP 适配器。
- npm `@deepseek-ai/dsh-feishu@0.2.3-alpha.1` 的说明是 official lark-cli 与插件页账号连接。`@deepseek-ai/dsh-dingtalk@0.2.3-alpha.1` 的说明是 official dws CLI。二者都不是可单独复用的签名库。

第 2 条被拒绝：没有一块边界清楚、可脱离 Cordis 宿主、且与当前钉死提交兼容的 MIT 模块。复制未知执行器会把 `danger-full-access` 带进来。Viva 不复制这两个仓库的源码。

第 3 条保留适配缝，并把未验证的执行集成标成 pending。没有 DSH 时，本地闭环仍然完整。

### 1.2 其他已定取舍

| 议题 | 决定 |
| --- | --- |
| 语言与进程 | TypeScript，Node 22。一个 Fastify 进程提供 API 与静态界面，另一个进程跑 worker。二者共享 SQLite。 |
| 存储 | `better-sqlite3`，WAL，SQL 迁移。FTS5 `trigram` 做词法检索。不用向量库，界面与 API 都写明不是向量搜索。 |
| 工作区 | 0.1.0 一个本地工作区。所有业务行带 `workspace_id`。没有多租户登录，不声称企业生产就绪。 |
| 界面 | 简体中文优先。React + Vite + Tailwind + Radix 原语（按钮、输入、对话框）。不是 Mintlify 的视觉克隆。 |
| 模型 | OpenAI Chat Completions 兼容。配置项只有 base URL、模型名、只写 API key。不写死 DeepSeek 为唯一供应商。另有明确标记的确定性演示提供者。 |
| 自动发布 | 默认关闭。即使用户打开，也只作用于本地知识版本，且有行数与类型限制。GitHub 只导出 PR 描述与补丁；打开远程 PR 的开关默认关闭，开发与测试不发送。 |
| 自动驾驶 | 期望状态持久化，默认 `stopped`。进程重启不得把停止改成运行。主机休眠或进程不在，则不会检查。 |
| 停机补跑 | 用户再次启动后，按检查点追赶停机期间的来源变化，并生成提案。这与 Mintlify 文档中“暂停期间的变化不补做更新”不同，是有意的。 |
| 渠道 | 飞书与钉钉都实现签名、重放保护、出站载荷与客户端函数。真实端到端标为等待凭证，不用模拟网络冒充已接通。 |
| 许可 | 原创代码 MIT。第三方依赖保留各自许可。参考项目只出现在 NOTICE，不把它们的版权声明说成 Viva 的代码。 |

### 1.3 Mintlify Autopilot 基准（事实与路线分开）

2026-11-25 读取的产品文档 `https://www.mintlify.com/docs/autopilot` 实际写了这些能力：代码变更与每日质量检查、并行子任务、用 GitHub API 开 PR 且不直接推送到部署分支或默认分支、对话上下文可在仪表盘、Slack、邮件与 GitHub 评论之间延续。默认由人合并。文档同时描述了可选 Auto merge：团队合并过三条 Autopilot PR 之后才能设置，且草稿、冲突、要求修改的评审、失败或仍在跑的检查、以及分支保护要求的评审都会拦住它。

用户给出的 2026-10-20 博客 FAQ 说它不自发布、由人合并，知识库 beta 缺少站点助手、分析与自动化，从审阅者修改中学习被列为后续工作。博客早于上面这版文档。Viva 把“博客当时没有自发布”和“现行文档有门控的可选自动合并”同时记下，不把博客句子改写成对现行产品的否定，也不把现行文档外推成完整的自我进化。

Viva 0.1.0 对标的是维护体验：后台发现变化、有界并行、提案与差异、人审、暂停、引用回答、反馈再进入提案。不对标的是：Mintlify 云端常驻、Git 应用安装、Slack/邮件通知、信用点计费、自动学习审阅编辑、站点分析。那些留在路线图，本版不声称已经具备。

## 2. 范围

### 2.1 本版要交付

- 本地 Markdown/文本目录来源，真实 GitHub REST 读取适配器（测试用夹具，现场调用另标），以及带 SSRF 防护的 URL 来源。
- 修订、校验和、时间、来源说明、软删除、手动重同步、间隔调度、带共享密钥的来源事件钩子。
- 持久检查点。期望状态为 running 时，启动后补跑停机期间的变化。
- SQLite 任务：入队、租约认领、有界并发、指数退避、幂等键、取消、崩溃后租约过期再认领、运行事件。
- 过期、冲突与内容变化生成可审提案。通过、拒绝、历史、回滚。自动发布默认关。
- 已发布知识的 FTS5 trigram 检索。回答带修订引用。证据不足则弃权。演示提供者与真实提供者分开，真实调用失败不会改走演示。
- 赞踩、评论、未回答问题。反馈变成任务和提案。提示词版本有评测门、比较、批准与回滚。不执行模型给出的代码。
- 飞书与钉钉的入站验签、重放保护、出站载荷与仅在显式允许时发送的客户端。
- 中文工作台：总览、来源、知识、运行、提案、提问、设置。演示数据有明确标签。
- 本机回环绑定、变更请求鉴权、密钥不进前端与日志、审计脱敏。
- Docker Compose 与不用 Docker 的路径、备份导出、不删数据的停止方式、GitHub Actions、API 文档、`.env.example`。

### 2.2 明确不做

- 不把 DSH 或 superagent 拉进依赖树，不启动它们的会话，不授予工具或 shell。
- 不实现向量检索、多用户 SSO、企业审计认证、GitHub Enterprise Server。
- 不在缺少显式开关和令牌时调用 GitHub 写接口、飞书或钉钉出站接口。
- 不把渠道合约测试写成端到端已接通。
- 不把工程验收写成用户 UAT 已签字。

## 3. 需求追踪

| ID | 需求 | 验收 |
| --- | --- | --- |
| R1 | 摄取本地 Markdown/文本，记录校验和、时间与来源 | 夹具目录同步后可按路径读到修订 |
| R2 | GitHub 仓库读取使用文档化的 REST，而不是推送 | 夹具 fetch 覆盖 tree/contents/compare；缺省不调用写接口 |
| R3 | URL 来源拒绝私网、元数据地址与跳转到私网 | SSRF 单测覆盖地址与重定向 |
| R4 | 路径穿越、越界符号链接、超限文件被拒绝 | 摄取单测 |
| R5 | 手动重同步、间隔调度、钩子触发 | API 与 worker 测试 |
| R6 | 检查点持久，停机后追赶 | 把成功时间拨回过去再启动，只为变化生成提案 |
| R7 | 任务有租约、并发上限、退避、幂等、取消、崩溃恢复 | 队列与重启测试 |
| R8 | 停止状态持久，进程重启不偷偷开始认领 | 期望状态为 stopped 时认领数为 0 |
| R9 | 变化、冲突、陈旧内容生成提案与差异 | 同步夹具 |
| R10 | 批准、拒绝、回滚改变已发布版本 | API 测试 |
| R11 | 自动发布默认关；打开后只在行数与类型允许时发布本地版本 | 策略测试 |
| R12 | 检索是 FTS5 trigram，回答含修订 id；无证据则弃权 | 提问测试与响应字段 `retrieval` |
| R13 | 演示提供者有固定标记；真实提供者可做连通性测试；错误不回落 | 提供者测试 |
| R14 | 模型调用次数、token 与估算费用有上限 | 超限时任务失败且不发第二次 |
| R15 | 反馈进入任务与提案；提示词候选须过评测门才能批准 | 策略测试 |
| R16 | 飞书签名与官方向量解密、时间窗、event_id 去重 | 合约测试 |
| R17 | 钉钉 HMAC 签名、时间窗、eventId 去重、出站 markdown 载荷 | 合约测试 |
| R18 | 来源正文与渠道正文不能改策略或启动自动驾驶 | 注入字符串测试 |
| R19 | 变更接口需要本机令牌；日志与 API 不见密钥 | API 测试 |
| R20 | 中文界面可完成来源、同步、提案、提问、反馈、停止 | 浏览器场景 |
| R21 | 备份不默认包含密钥；普通停止不删数据卷 | 备份测试与运维文档 |

## 4. 运行边界

主机必须醒着，worker 进程必须在跑，而且期望状态必须是 `running`，调度才会发生。笔记本睡眠、进程退出、Docker 容器停止，都等于这段时间没有检查。检查点留在数据目录。用户按下启动后，worker 才按检查点追赶。

默认期望状态是 `stopped`。安装或重启进程只恢复心跳，不改期望状态。停止会释放本 worker 尚未完成的租约，把那些任务放回 pending，并且不把这次停止计为失败。pending 任务在停止期间不被认领。

0.1.0 不是云端常驻。文档与总览都写这句话。

数据目录默认 `./data`，可用 `VIVA_DATA_DIR` 覆盖。SQLite 文件是 `viva.sqlite`。密钥在 `secrets.json`，权限 0600，不在数据库里。本地令牌在 `token`。

监听地址默认 `127.0.0.1`，端口默认 `43123`。只有 `VIVA_ALLOW_NONLOCAL=1` 才允许其他地址，此时会话引导接口关闭，调用方必须自己携带令牌。不信任 `X-Forwarded-For`。

## 5. 组件

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| `src/db` | 打开数据库、迁移、工作区种子 | 业务规则 |
| `src/jobs/queue.ts` | 入队、认领、心跳续租、完成、失败退避、取消、事件 | 具体业务 |
| `src/control/state.ts` | 期望状态、心跳、策略与模型配置 | 认领任务 |
| `src/sources/*` | 本地、GitHub、URL 快照 | 决定是否发布 |
| `src/knowledge/*` | 提案、差异、发布、回滚、检索、回答 | 进程监督 |
| `src/model/providers.ts` | 演示提供者与 OpenAI 兼容提供者 | 渠道 |
| `src/channels/*` | 验签、解密、重放、出站载荷 | 真实群机器人开通 |
| `src/policy/prompts.ts` | 提示词版本、评测门、批准、回滚 | 任意代码改写 |
| `src/runtime/dshProbe.ts` | 记录钉死版本并只执行 `--version` | 启动代理或工具 |
| `src/worker/loop.ts` | 遵守期望状态、有界认领、调度、分发 | HTTP |
| `src/server/app.ts` | HTTP、鉴权、静态界面 | 长期循环 |
| `web/` | 中文工作台 | 直接读数据库 |

worker 并发上限默认 2，可用 `VIVA_WORKER_CONCURRENCY` 设置，最大 4。单任务租约 30 秒，处理中续租。失败退避为 2、4、8、16、32 秒，默认最多 5 次。

## 6. 数据流

1. 用户添加来源。配置进 SQLite，密钥只进 `secrets.json` 的引用。
2. 手动同步、间隔调度或来源钩子插入 `source.sync`。幂等键分别是手动 nonce、`sync:{sourceId}:{lastSuccessAt}` 与钩子事件 id。
3. 同步读取快照，写入 `source_revisions` 与 `documents`，更新 `checkpoints`。
4. 与已发布校验和比较。变化、删除、标题冲突、已发布修订落后于来源，各插入一条提案。提案幂等键包含来源、路径、旧校验和与新校验和。
5. 每个变化再入队 `knowledge.propose`，以便在并发上限内并行写差异。同步任务本身不调用模型。
6. 人批准后写 `published_chunks`，FTS 由触发器维护，旧文本进入 `published_history`。拒绝只改提案状态。回滚用历史恢复并再写 FTS。
7. 提问先检索。零命中直接弃权，不调用模型。有命中时，演示提供者返回摘录并带固定前缀；真实提供者只看到被标记为不可信数据的片段。回答保存引用的修订 id。
8. 踩、评论或弃权写入反馈并入队 `feedback.triage`，生成待审提案。提示词候选入队 `policy.evaluate`，分数不低于当前生效版本才允许批准。批准前不生效。
9. 渠道请求先验签和重放。正文只成为待审提案，不能改控制状态。

来源正文、检索片段和渠道消息都是数据。系统提示固定写明它们不能授权动作。没有任何工具执行器把模型输出变成 shell、Git 推送或渠道发送。

## 7. 接口契约

### 7.1 模型

`PUT /api/settings/model` 接受 `mode`（`demo` 或 `live`）、`baseUrl`、`model`、可选 `apiKey`。响应只有 `hasKey: boolean` 与非秘密字段。`POST /api/settings/model/test` 对 live 发送一次 `max_tokens` 为 1 的 Chat Completions；网络与 HTTP 错误原样返回。demo 测试返回 `provider: "demo"`，不访问网络。live 未配置密钥时返回 400，而不是演示文本。

费用账本用配置里的 `usdPer1kTokens` 估算。默认每任务最多 4 次调用、每次最多 800 token、估算不超过 0.05 美元。超限把任务标为失败，原因是 `bound_exceeded`。

### 7.2 任务状态

`pending`、`leased`、`succeeded`、`failed`、`cancelled`。界面把 `leased` 显示为进行中。列表接口返回计数与最近事件。取消把 pending 或 leased 标为 `cancelled`。已成功的任务不能取消。

### 7.3 检索

`POST /api/ask` 响应包含 `retrieval: "fts5-trigram"`、`providerMode`、`abstained`、`citations[]`。每条引用有 `revisionId`、`path`、`checksum`、`snippet`。少于 3 个字的查询走标题与正文的 LIKE，响应里的 `retrieval` 改为 `like-fallback`，仍然不是向量搜索。

### 7.4 飞书

按飞书开放平台“发送通知到开发者服务器”的签名：`SHA256(timestamp + nonce + encryptKey + rawBody)`，与 `X-Lark-Request-Timestamp`、`X-Lark-Request-Nonce`、`X-Lark-Signature` 比较。时间窗 5 分钟。加密事件用官方示例的 AES-256-CBC：密钥为 encrypt key 的 SHA-256，IV 为密文前 16 字节。官方向量 `encrypt = P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk=`、key `test key` 必须解出 `hello world`。`url_verification` 在验签通过后回 `challenge`。`event_id` 重复返回 200 且不第二次入队。

### 7.5 钉钉

签名为 `Base64(HMAC-SHA256(timestamp + "\n" + secret, secret))`，读取头 `timestamp` 与 `sign`。比较时同时接受 URL 解码后的值。时间戳大于 10^12 视为毫秒，否则视为秒。时间窗 5 分钟，比平台常见的 1 小时更紧。`eventId` 去重。缺少可解析 `eventId` 的请求拒绝。加密字段 `encrypt` 返回 501 `decrypt_pending`，不假装已解密。出站自定义机器人载荷是 `msgtype: markdown`。

2026-11-25 抓取 `https://open.dingtalk.com/document/orgapp/configure-event-subcription` 没有得到正文。算法以上述公开构造实现，并由合约测试锁定；在用真实回调对拍之前，钉钉适配器的现场兼容标为未验证。

### 7.6 DSH 探测

`GET /api/runtime/dsh` 返回钉死版本、提交、Node 要求、本机 Node、以及状态：

- `not_configured`：没有 `VIVA_DSH_BIN`
- `binary_missing`：路径不存在
- `probe_error`：超时或非零退出
- `version_mismatch`
- `version_matched_unvalidated`：版本字符串匹配 `0.2.3-alpha.2`，执行集成仍是 pending

探测只运行 `"<bin>" --version`，超时 3 秒，不传其他参数，不继承可执行搜索去调用未知工具。即使版本匹配，也不创建会话。superagent 原型的提交与 peer 版本写入同一响应的 `prototype` 字段，`execution: "pending"`。

### 7.7 GitHub 发布

批准提案不会打开 PR。`POST /api/proposals/:id/export` 在数据目录写入 PR 标题、正文和补丁。`githubPublishEnabled` 默认 false。只有它为 true、存在令牌、并且请求体 `confirm: "open-pull-request"` 时，才 `POST /repos/{owner}/{repo}/pulls`。测试断言默认路径的 fetch 次数为 0。

## 8. 威胁与对策

| 威胁 | 对策 |
| --- | --- |
| 把服务暴露到局域网 | 默认只绑回环；非回环必须显式开关并关闭引导接口 |
| 跨站请求伪造 | Cookie `SameSite=Strict`、`HttpOnly`，变更请求另要头 `x-viva-request: 1` |
| 密钥进入界面、备份或日志 | 只写存储、备份默认排除 `secrets.json` 与 `token`、日志经键名脱敏 |
| 来源或渠道提示注入 | 无工具执行器；固定系统提示；注入句子的回归测试 |
| SSRF 与重定向绕过 | 手动重定向，解析后的每个地址都检查；拒绝私网、链路本地、组播、回环与 `169.254.169.254` |
| 路径穿越与符号链接 | 逻辑路径拒绝 `..`；`realpath` 必须仍在根目录内 |
| 大文件耗尽磁盘 | 单文件 512 KiB，URL 正文 1 MiB，Webhook 256 KiB |
| 签名重放 | 时间窗加事件 id 唯一约束 |
| 租约双执行 | 幂等键与发布状态机；重复批准是空操作 |
| 停止被监督进程打回运行 | 期望状态只由启动接口改写 |
| 演示结果冒充线上模型 | `providerMode` 与固定中文前缀；live 失败返回错误对象 |

未缓解且必须写在界面上的限制：本机其他用户若能读数据目录就能读知识库；这不是多用户隔离。SQLite 文件没有应用层加密。

## 9. 验收与里程碑

M1 数据、队列、本地来源、提案、检索、停止与检查点，由单元和集成测试验收。

M2 GitHub 夹具、URL、渠道合约、模型界限、策略门，由单元测试验收。

M3 中文界面、Docker 文件、CI、备份、浏览器场景，由构建、浏览器操作和冒烟脚本验收。

工程验收场景写在 `docs/acceptance/`，标题标明它不是用户 UAT。用户 UAT 仍待真人执行。

平台：本工作区是 Linux x86_64。文档只把 Linux 标为已测。macOS 与 Windows 写为未测，不推测结果。Docker 是否跑过，以当时的命令输出为准；只提交 Compose 文件不算测过。

## 10. 自审

- 没有留下 TBD 或“以后再定”的行为。未验证的集成写成 pending，并写了判定状态。
- 自动发布默认关闭，与 GitHub 写接口的开关是两个开关。
- 检索字段不允许写成 vector。
- 停止与追赶的关系只在期望状态变回 running 后发生，和“重启进程不偷偷开工”不矛盾。
- 飞书解密有官方向量；钉钉解密没有，所以加密回调返回 501。
- 范围可以在一个实现计划里落地：一个本地工作区、一条知识闭环、两类渠道合约、一个不执行的运行时探测。
