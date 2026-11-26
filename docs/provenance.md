# 依赖来源

2026-11-25 核对，只读了公开的 README、LICENSE、package.json、SAFETY.md、执行与授权文档，以及 npm 元数据。没有把这些仓库的源码复制进 Viva。

| 项目 | 身份 | 许可证 | 钉死点 | Viva 里的状态 |
| --- | --- | --- | --- | --- |
| DeepSeek Harness | `deepseek-ai/deepseek-harness`，npm `@deepseek-ai/dsh@0.2.3-alpha.2` | MIT，Copyright (c) 2026 DeepSeek | 标签 `dsh-v0.2.3-alpha.2`，提交 `4b399c39a6d1479cd84ca591b4d7c88e24d38a96` | 在 Node v24.22.3 上执行了 `dsh --version`，输出 `0.2.3-alpha.2`。只读 headless 冒烟的真实结果是 `MISSING_CREDENTIAL`，见 `tests/fixtures/dsh-headless-missing-credential.jsonl`。没有使用 `danger-full-access`。 |
| dsh-superagent-prototype | `deepseek-ai/dsh-superagent-prototype` | MIT，Copyright (c) 2026 DeepSeek Harness Team | 唯一提交 `8c32a9dc5d72c033816c6a8110b37f40cf94fba4` | peer 依赖 dsh `^0.2.1-alpha.2`，与上面的钉死版本不一致。不加载。执行 pending |
| 飞书插件包 | npm `@deepseek-ai/dsh-feishu@0.2.3-alpha.1` | 随 harness | 说明文字是 official lark-cli | 未依赖。Viva 自己实现 HTTP 验签 |
| 钉钉插件包 | npm `@deepseek-ai/dsh-dingtalk@0.2.3-alpha.1` | 随 harness | 说明文字是 official dws CLI | 未依赖。没有官方钉钉 Source 可对齐 |

Mintlify Autopilot 的产品文档于同日抓取：https://www.mintlify.com/docs/autopilot 。博客 https://www.mintlify.com/blog/autopilot 的 2026-10-20 FAQ 由任务说明引用：当时写的是不自发布、由人合并。同日抓到的产品文档已经描述了可选、有门禁的 Auto merge。Viva 把两者都当成时间点上的事实，不把博客写成对现行文档的否定。Viva 的自动发布仍然默认关闭，并且不学习审阅者的修改。
