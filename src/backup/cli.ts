import { openDatabase } from "../db/database.js";
import { createBackup } from "./backup.js";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("用法: node dist/backup/cli.js");
  console.log("只备份当前数据目录里的 SQLite。密钥和令牌不复制。");
  console.log("VIVA_DATA_DIR 默认是 ./data。");
  console.log("--help 只打印说明，不会创建备份。");
  process.exit(0);
}
const unknown = args.filter((arg) => arg.startsWith("-"));
if (unknown.length > 0 || args.length > 0) {
  console.error(`无法识别的参数: ${args.join(" ")}`);
  process.exit(2);
}

const dir = process.env.VIVA_DATA_DIR ?? "data";
const db = openDatabase(dir);
const dest = createBackup(db, dir, Date.now());
console.log(dest);
db.close();
