# Viva

Viva 是本地优先的知识工程工作台。名字来自拉丁语，表示活着的、新鲜的。它在你自己的机器上完成这条环：来源进来，发现变化，生成带差异的提案，人审阅后发布，提问时引用具体修订，反馈再变成下一轮提案。

它不是 Mintlify 的界面仿制品，也不打包 DeepSeek Harness 或 dsh-superagent。那两个项目的关系、许可证和未验证的执行边界写在 [NOTICE](NOTICE) 与 [设计规格](docs/superpowers/specs/2026-11-26-viva-design.md)。

0.1.0 在本工作区的 Linux x64 上跑过测试。macOS 和 Windows 没有跑过。Docker Compose 文件在仓库里，本环境没有 Docker 守护进程，所以没有把容器启动算作已测试。

## 现成 Linux 包

目录里已经有 `dist/` 和 `web/dist/`，没有 `tsconfig.json`。需要 Node.js 22.13 或更新版本。

```bash
npm ci
npm run build
npm run viva
```

这里的 `npm run build` 不会去找 TypeScript。它会说明产物已经在，然后以退出码 0 结束。接着 `npm run viva` 启动界面和 worker。不要为了启动去补源码。

```bash
npm run backup -- --help
npm run smoke
npm run backup
```

`--help` 只打印说明，不会创建备份。无法识别的参数会失败并且不写备份。

## 源码包

目录里有 `src/` 和 `tsconfig.json`。

```bash
npm ci
npm run build
npm run viva
```

这次 `npm run build` 会编译服务器和界面。

`npm run viva` 同时启动界面和 worker。按 Ctrl+C 会把两个进程都停掉，但不会把已经停止的自动驾驶改成运行。只开界面可以用 `npm start`。

浏览器打开的是运行这台电脑上的 http://127.0.0.1:43123 。开发时可以用 `npm run dev`。

第一次打开会在 `data/token` 写下本机令牌，并用只在回环地址上发放的 Cookie 交给界面。密钥在 `data/secrets.json`，不要提交。

自动驾驶默认是停止的。按下启动之后，只有这个进程还在、电脑也醒着，才会按间隔检查来源。睡眠或关机期间不会检查；你再次启动后，它用检查点补上停下来的变化。停止之后，就算 worker 进程被重新拉起，也不会自己开始认领任务。

界面里的“载入演示数据”会写入一份标明演示的本地手册。没有配置真实模型时，回答来自确定性的演示提供者，开头是“【演示提供者·非实时模型】”，不会假装自己在调用线上模型。

## 常用命令

```bash
npm test
npm run build
npx playwright test
bash scripts/smoke.sh
npm run backup
```

更多说明：

- [中文快速开始](docs/quickstart.zh.md)
- [架构](docs/architecture.md)
- [HTTP API](docs/api.md)
- [安全](docs/security.md)
- [备份与运行](docs/operations.md)
- [工程验收记录](docs/acceptance/2026-11-26-engineering-uat.md)

## 数据

`docker compose down` 不会删除命名卷 `viva-data`。`docker compose down -v` 会删掉那一卷里的数据库，不要把它当成普通停止。

默认备份写到数据目录的 `backups/`，只复制 SQLite 和一份不含密钥的清单。
