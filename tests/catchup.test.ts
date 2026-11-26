import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { setDesiredState } from "../src/control/state.js";
import { publishProposal } from "../src/knowledge/publish.js";
import { createSource } from "../src/sources/registry.js";
import { syncSource } from "../src/sources/sync.js";
import { workerTick } from "../src/worker/loop.js";
import { tempWorkspace } from "./helpers.js";

describe("checkpoint catch-up", () => {
  it("creates a proposal for edits made while the worker was stopped", async () => {
    const { db } = tempWorkspace();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-catch-"));
    const file = path.join(root, "note.md");
    fs.writeFileSync(file, "停机前的正文，记录最初检查点。\n");
    const source = createSource(db, { kind: "local", name: "追赶", root, intervalSeconds: 60, nowMs: 0 });
    syncSource(db, source.id, { nowMs: 1_000 });
    publishProposal(db, (db.prepare("SELECT id FROM proposals").get() as { id: string }).id, 1_500);
    setDesiredState(db, "stopped", 2_000);
    fs.writeFileSync(file, "停机期间改过的正文，启动后应该被发现。\n");
    const idle = await workerTick(db, { owner: "w", nowMs: 3_000, fetchImpl: fetch });
    expect(idle.claimed).toBe(0);
    expect(db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE status = 'pending_review'").get()).toEqual({ n: 0 });
    setDesiredState(db, "running", 4_000);
    db.prepare("UPDATE checkpoints SET last_success_at = ? WHERE source_id = ?").run(new Date(0).toISOString(), source.id);
    const caught = await workerTick(db, { owner: "w", nowMs: 120_000, fetchImpl: fetch });
    expect(caught.claimed).toBeGreaterThan(0);
    const pending = db.prepare("SELECT kind FROM proposals WHERE status = 'pending_review'").get() as { kind: string };
    expect(pending.kind).toBe("stale");
  });
});
