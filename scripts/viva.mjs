import { spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";

const major = Number(process.versions.node.split(".")[0]);
if (major < 22) {
  console.error(`需要 Node.js 22 或更新的版本。当前是 ${process.version}。`);
  process.exit(1);
}
if (!fs.existsSync("dist/server/main.js") || !fs.existsSync("web/dist/index.html")) {
  console.error("还没有构建产物。请先在这个目录执行 npm ci，然后 npm run build。");
  process.exit(1);
}

const env = { ...process.env };
const port = env.VIVA_PORT ?? "43123";
const server = spawn(process.execPath, ["dist/server/main.js"], { stdio: "inherit", env });
const worker = spawn(process.execPath, ["dist/worker/main.js"], { stdio: "inherit", env });
let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  server.kill("SIGTERM");
  worker.kill("SIGTERM");
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
server.on("exit", (code) => {
  if (!shuttingDown) shutdown();
  process.exit(code ?? 0);
});
worker.on("exit", () => {
  if (!shuttingDown) shutdown();
});
console.log(`Viva 启动后可在本机打开 http://127.0.0.1:${port}`);
console.log("这是运行程序的这台电脑上的地址。Ctrl+C 会同时停止界面和 worker，不会把已停止的自动驾驶改成运行。");
