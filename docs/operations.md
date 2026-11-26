# 运行、备份和停止

## 进程

`npm start` 只提供界面和 API。`npm run worker` 才做间隔调度。两个进程可以分开重启。期望状态写在 SQLite 的 `control` 表，不写在进程内存里。

worker 的 Compose 服务使用 `restart: unless-stopped`。这只是在容器退出后续跑进程。进程起来后会读到上次的停止状态，不会把停止改成运行。你在界面上按停止，worker 就空转并心跳为 idle。

主机睡眠、关机、进程没起，这段时间都不会检查来源。检查点留在 `checkpoints`。再次启动后，若距离上次成功已经超过来源的间隔，worker 会入队同步并比较内容。

## 不用 Docker

```bash
npm ci
npm run build
VIVA_DATA_DIR=./data npm start
VIVA_DATA_DIR=./data npm run worker
```

备份：

```bash
VIVA_DATA_DIR=./data npm run backup
```

备份目录在 `data/backups/<时间>/`，里面是 `viva.sqlite` 和 `manifest.json`。恢复时先停掉 server 和 worker，把 `viva.sqlite` 复制回数据目录。不要把 `secrets.json` 和 `token` 跟数据库备份混在一起传输出去。

## Docker Compose

```bash
docker compose up --build
```

端口只绑在宿主机的 `127.0.0.1:43123`。数据在命名卷 `viva-data`。

```bash
docker compose down
```

上面这条保留数据卷。

```bash
docker compose down -v
```

这条会删除 `viva-data`。那是删数据，不是普通停止。

本开发环境没有 Docker 守护进程，因此没有执行 `docker compose up`。文件里的健康假设还没有被容器运行证实。

## 平台

已在 Linux x86_64、Node v22.23.4 上执行单元测试、构建、冒烟和 Playwright。macOS 与 Windows 未测试。CI 工作流也只在 `ubuntu-latest` 上。
