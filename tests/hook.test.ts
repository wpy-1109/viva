import { createHmac } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";
import { workerTick } from "../src/worker/loop.js";
import { openDatabase } from "../src/db/database.js";

describe("source hook", () => {
  it("queues a catch-up sync from a signed hook and ignores a bad signature", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viva-hook-"));
    const root = path.join(dir, "docs");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "note.md"), "钩子触发前的正文。\n");
    const app = await createApp({ dataDir: dir });
    const token = fs.readFileSync(path.join(dir, "token"), "utf8").trim();
    const headers = { "x-viva-token": token, "x-viva-request": "1", "content-type": "application/json" };
    const created = await app.inject({
      method: "POST",
      url: "/api/sources",
      headers,
      payload: { kind: "local", name: "钩子来源", root, hookSecret: "hook-secret" },
    });
    expect(created.statusCode).toBe(200);
    const sourceId = created.json().id as string;
    const body = JSON.stringify({ eventId: "push-1" });
    const bad = await app.inject({ method: "POST", url: `/api/hooks/sources/${sourceId}`, headers: { "content-type": "application/json" }, payload: body });
    expect(bad.statusCode).toBe(401);
    const signature = createHmac("sha256", "hook-secret").update(body).digest("hex");
    const good = await app.inject({
      method: "POST",
      url: `/api/hooks/sources/${sourceId}`,
      headers: { "content-type": "application/json", "x-viva-hook-signature": signature },
      payload: body,
    });
    expect(good.statusCode).toBe(202);
    await app.close();
    const db = openDatabase(dir);
    const queued = db.prepare("SELECT status FROM jobs WHERE type = 'source.sync'").get() as { status: string };
    expect(queued.status).toBe("pending");
    fs.writeFileSync(path.join(root, "note.md"), "钩子之后改过的正文，启动后应追赶。\n");
    const idle = await workerTick(db, { owner: "w", nowMs: Date.now(), fetchImpl: fetch });
    expect(idle.claimed).toBe(0);
    const started = db.prepare("UPDATE control SET value = 'running' WHERE key = 'desired'").run();
    expect(started.changes).toBe(1);
    const ran = await workerTick(db, { owner: "w", nowMs: Date.now(), fetchImpl: fetch });
    expect(ran.claimed).toBeGreaterThan(0);
    const proposal = db.prepare("SELECT kind FROM proposals").get() as { kind: string };
    expect(proposal.kind).toBe("change");
    db.close();
  });
});