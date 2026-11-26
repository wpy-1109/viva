import { spawnSync } from "node:child_process";
import fs from "node:fs";

const args = process.argv.slice(2);
if (fs.existsSync("dist/backup/cli.js")) {
  const result = spawnSync(process.execPath, ["dist/backup/cli.js", ...args], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
if (fs.existsSync("src/backup/cli.ts")) {
  const result = spawnSync("npx", ["tsx", "src/backup/cli.ts", ...args], { stdio: "inherit" });
  process.exit(result.status ?? 1);
}
console.error("找不到备份程序。源码包请先 npm run build；现成包应包含 dist/backup/cli.js。");
process.exit(1);
