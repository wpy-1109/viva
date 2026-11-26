import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { enqueue } from "../src/jobs/queue.js";
import { tempWorkspace } from "./helpers.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("two process claims", () => {
  it("lets only one process take the same pending job", () => {
    const { dir, db } = tempWorkspace();
    enqueue(db, { type: "noop", idempotencyKey: "race", payload: {}, nowMs: 0 });
    db.close();
    const code = `
      import { openDatabase } from "./src/db/database.ts";
      import { claim } from "./src/jobs/queue.ts";
      const db = openDatabase(process.argv[1]);
      const rows = claim(db, { owner: process.argv[2], nowMs: Date.now() + 10_000, leaseMs: 30_000, limit: 1 });
      process.stdout.write(rows.map((row) => row.id).join(","));
      db.close();
    `;
    const run = (owner: string) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, dir, owner], {
      cwd: root,
      encoding: "utf8",
    });
    const first = run("a");
    const second = run("b");
    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const ids = [first.stdout, second.stdout].filter(Boolean);
    expect(new Set(ids).size).toBe(1);
    expect(second.stdout).toBe("");
  });
});
