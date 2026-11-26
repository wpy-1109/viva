import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("backup cli", () => {
  it("prints help without creating a data directory and rejects unknown flags", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viva-help-"));
    const missing = path.join(dir, "absent");
    const help = spawnSync(process.execPath, ["--import", "tsx", "src/backup/cli.ts", "--help"], {
      cwd: process.cwd(),
      env: { ...process.env, VIVA_DATA_DIR: missing },
      encoding: "utf8",
    });
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("不会创建备份");
    expect(fs.existsSync(missing)).toBe(false);
    const unknown = spawnSync(process.execPath, ["--import", "tsx", "src/backup/cli.ts", "--nope"], {
      cwd: process.cwd(),
      env: { ...process.env, VIVA_DATA_DIR: missing },
      encoding: "utf8",
    });
    expect(unknown.status).toBe(2);
    expect(fs.existsSync(missing)).toBe(false);
  });
});