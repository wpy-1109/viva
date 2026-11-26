import { spawnSync } from "node:child_process";
import fs from "node:fs";

if (!fs.existsSync("tsconfig.json")) {
  const ready = fs.existsSync("dist/server/main.js") && fs.existsSync("web/dist/index.html");
  if (ready) {
    console.log("这是已经构建好的现成包，目录里没有 TypeScript 源码，因此不会运行 tsc。");
    console.log("构建产物 dist/ 和 web/dist/ 已经可用。请执行 npm run viva。");
    console.log("要修改程序，请改用带 src/ 和 tsconfig.json 的源码包。");
    process.exit(0);
  }
  console.error("找不到 tsconfig.json，也找不到可用的 dist/server/main.js。这个目录不完整。");
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npx", ["tsc", "-p", "tsconfig.json"]);
fs.mkdirSync("dist/db/migrations", { recursive: true });
fs.copyFileSync("src/db/migrations/001_init.sql", "dist/db/migrations/001_init.sql");
run("npx", ["vite", "build", "--config", "vite.config.ts"]);
