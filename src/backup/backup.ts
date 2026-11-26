import fs from "node:fs";
import path from "node:path";
import type { VivaDb } from "../db/database.js";

export function createBackup(db: VivaDb, dataDir: string, nowMs: number) {
  const stamp = new Date(nowMs).toISOString().replace(/[:.]/g, "-");
  const dest = path.join(dataDir, "backups", stamp);
  fs.mkdirSync(dest, { recursive: true });
  db.pragma("wal_checkpoint(FULL)");
  fs.copyFileSync(path.join(dataDir, "viva.sqlite"), path.join(dest, "viva.sqlite"));
  const manifest = {
    createdAt: new Date(nowMs).toISOString(),
    includes: ["viva.sqlite"],
    excludes: ["secrets.json", "token"],
    note: "默认备份不含密钥与本机令牌。",
  };
  fs.writeFileSync(path.join(dest, "manifest.json"), JSON.stringify(manifest, null, 2));
  return dest;
}

export function restoreBackup(dataDir: string, backupDir: string) {
  const source = path.join(backupDir, "viva.sqlite");
  const dest = path.join(dataDir, "viva.sqlite");
  fs.copyFileSync(source, dest);
  fs.rmSync(`${dest}-wal`, { force: true });
  fs.rmSync(`${dest}-shm`, { force: true });
}
