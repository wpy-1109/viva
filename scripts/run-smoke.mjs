import { spawnSync } from "node:child_process";
import fs from "node:fs";

if (!fs.existsSync("scripts/smoke.sh")) {
  console.error("找不到 scripts/smoke.sh。");
  process.exit(1);
}
const result = spawnSync("bash", ["scripts/smoke.sh"], { stdio: "inherit" });
process.exit(result.status ?? 1);
