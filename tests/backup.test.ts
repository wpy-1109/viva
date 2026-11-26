import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createBackup, restoreBackup } from "../src/backup/backup.js";
import { openDatabase } from "../src/db/database.js";
import { readSecret } from "../src/secrets/store.js";
import { saveModel } from "../src/control/state.js";
import { tempWorkspace } from "./helpers.js";

describe("backup", () => {
  it("copies the database and leaves secrets behind", () => {
    const { dir, db } = tempWorkspace();
    saveModel(db, { mode: "live", baseUrl: "https://models.example/v1", model: "m", apiKey: "sk-backup-secret", nowMs: 1 });
    const secret = fs.readFileSync(path.join(dir, "secrets.json"), "utf8");
    expect(secret).not.toContain("sk-backup-secret");
    expect(readSecret(dir, "model:local")).toBe("sk-backup-secret");
    expect(fs.statSync(path.join(dir, "secrets.json")).mode & 0o777).toBe(0o600);
    const dest = createBackup(db, dir, 1_700_000_000_000);
    const copied = fs.readdirSync(dest).sort();
    expect(copied).toContain("viva.sqlite");
    expect(copied).not.toContain("secrets.json");
    expect(copied).not.toContain("token");
    const blob = fs.readFileSync(path.join(dest, "manifest.json"), "utf8");
    expect(blob).not.toContain("sk-backup-secret");
    db.prepare("INSERT INTO workspaces (id, name, created_at) VALUES ('extra', '临时', 'x')").run();
    db.close();
    restoreBackup(dir, dest);
    const restored = openDatabase(dir);
    expect(restored.prepare("SELECT id FROM workspaces WHERE id = 'extra'").get()).toBeUndefined();
    restored.close();
  });
});
