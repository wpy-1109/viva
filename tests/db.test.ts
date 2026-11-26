import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "../src/db/database.js";
import { tempWorkspace } from "./helpers.js";

describe("database", () => {
  it("seeds one local workspace and does not apply migrations twice", () => {
    const { dir, db } = tempWorkspace();
    const workspaces = db.prepare("SELECT id, name FROM workspaces").all() as { id: string; name: string }[];
    expect(workspaces).toEqual([{ id: "local", name: "本地工作区" }]);
    const desired = db.prepare("SELECT value FROM control WHERE workspace_id = ? AND key = ?").get("local", "desired") as { value: string };
    expect(desired.value).toBe("stopped");
    const policy = db.prepare("SELECT autopublish_enabled, github_publish_enabled FROM policies WHERE workspace_id = ?").get("local") as {
      autopublish_enabled: number;
      github_publish_enabled: number;
    };
    expect(policy.autopublish_enabled).toBe(0);
    expect(policy.github_publish_enabled).toBe(0);
    db.close();
    const again = openDatabase(dir);
    const migrations = again.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as { n: number };
    expect(migrations.n).toBe(1);
    again.close();
    expect(fs.existsSync(path.join(dir, "viva.sqlite"))).toBe(true);
  });
});
