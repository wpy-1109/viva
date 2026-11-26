import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { cancel, claim, counts, enqueue, fail, releaseOwnedLeases, succeed } from "../src/jobs/queue.js";
import { getDesiredState, setDesiredState } from "../src/control/state.js";
import { workerTick } from "../src/worker/loop.js";
import { tempWorkspace } from "./helpers.js";

describe("job queue", () => {
  it("keeps the first payload for an idempotency key", () => {
    const { db } = tempWorkspace();
    const first = enqueue(db, { type: "source.sync", idempotencyKey: "same", payload: { n: 1 }, nowMs: 1_000 });
    const second = enqueue(db, { type: "source.sync", idempotencyKey: "same", payload: { n: 2 }, nowMs: 1_000 });
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(JSON.parse(second.job.payload_json)).toEqual({ n: 1 });
  });

  it("claims up to the concurrency limit", () => {
    const { db } = tempWorkspace();
    for (let i = 0; i < 3; i += 1) {
      enqueue(db, { type: "noop", idempotencyKey: `k${i}`, payload: {}, nowMs: 1_000 });
    }
    const claimed = claim(db, { owner: "w1", nowMs: 2_000, leaseMs: 30_000, limit: 2 });
    expect(claimed).toHaveLength(2);
    expect(counts(db)).toMatchObject({ pending: 1, leased: 2 });
  });

  it("lets a second worker take an expired lease and finish it", () => {
    const { db } = tempWorkspace();
    const { job } = enqueue(db, { type: "noop", idempotencyKey: "once", payload: { step: 1 }, nowMs: 1_000 });
    const first = claim(db, { owner: "dead", nowMs: 2_000, leaseMs: 1_000, limit: 1 });
    expect(claim(db, { owner: "live", nowMs: 2_500, leaseMs: 1_000, limit: 1 })).toHaveLength(0);
    const second = claim(db, { owner: "live", nowMs: 4_000, leaseMs: 30_000, limit: 1 });
    expect(second.map((row) => row.id)).toEqual([first[0].id]);
    expect(second[0].attempts).toBe(2);
    const done = succeed(db, job.id, 4_000);
    expect(done.status).toBe("succeeded");
    expect(counts(db).leased).toBe(0);
  });

  it("backs off and then marks the job failed", () => {
    const { db } = tempWorkspace();
    const { job } = enqueue(db, { type: "noop", idempotencyKey: "retry", payload: {}, nowMs: 0, maxAttempts: 2 });
    claim(db, { owner: "w", nowMs: 0, leaseMs: 1_000, limit: 1 });
    const waiting = fail(db, job.id, "boom", 0);
    expect(waiting.status).toBe("pending");
    expect(Date.parse(waiting.run_after)).toBe(2_000);
    expect(claim(db, { owner: "w", nowMs: 1_000, leaseMs: 1_000, limit: 1 })).toHaveLength(0);
    claim(db, { owner: "w", nowMs: 2_000, leaseMs: 1_000, limit: 1 });
    expect(fail(db, job.id, "boom", 2_000).status).toBe("failed");
  });

  it("cancels pending work and does not cancel a finished job", () => {
    const { db } = tempWorkspace();
    const pending = enqueue(db, { type: "noop", idempotencyKey: "p", payload: {}, nowMs: 0 }).job;
    const done = enqueue(db, { type: "noop", idempotencyKey: "d", payload: {}, nowMs: 0 }).job;
    claim(db, { owner: "w", nowMs: 0, leaseMs: 1_000, limit: 2 });
    succeed(db, done.id, 0);
    expect(cancel(db, pending.id, 1).status).toBe("cancelled");
    expect(cancel(db, done.id, 1).status).toBe("succeeded");
  });

  it("does not claim after a deliberate stop, including across a reopened database", () => {
    const { dir, db } = tempWorkspace();
    enqueue(db, { type: "source.sync", idempotencyKey: "later", payload: { sourceId: "missing" }, nowMs: 0 });
    setDesiredState(db, "stopped", 0);
    expect(getDesiredState(db)).toBe("stopped");
    return workerTick(db, { owner: "w", nowMs: 10_000, fetchImpl: fetch }).then(async (first) => {
      expect(first.claimed).toBe(0);
      db.close();
      const reopened = new Database(path.join(dir, "viva.sqlite"));
      reopened.pragma("busy_timeout = 5000");
      const row = reopened.prepare("SELECT value FROM control WHERE key = 'desired'").get() as { value: string };
      expect(row.value).toBe("stopped");
      const second = await workerTick(reopened, { owner: "w2", nowMs: 20_000, fetchImpl: fetch });
      expect(second.claimed).toBe(0);
      expect(counts(reopened).pending).toBe(1);
      reopened.close();
      expect(fs.existsSync(path.join(dir, "viva.sqlite"))).toBe(true);
    });
  });

  it("does not let a late success overwrite cancellation", () => {
    const { db } = tempWorkspace();
    const { job } = enqueue(db, { type: "noop", idempotencyKey: "cancel-race", payload: {}, nowMs: 0 });
    claim(db, { owner: "w", nowMs: 0, leaseMs: 60_000, limit: 1 });
    expect(cancel(db, job.id, 10).status).toBe("cancelled");
    expect(succeed(db, job.id, 20).status).toBe("cancelled");
    expect(fail(db, job.id, "late", 30).status).toBe("cancelled");
  });

  it("returns a stopped worker's lease to pending without counting a failure", () => {
    const { db } = tempWorkspace();
    const { job } = enqueue(db, { type: "noop", idempotencyKey: "held", payload: {}, nowMs: 0 });
    claim(db, { owner: "w", nowMs: 0, leaseMs: 60_000, limit: 1 });
    releaseOwnedLeases(db, "w", 10);
    const row = db.prepare("SELECT status, attempts, lease_owner FROM jobs WHERE id = ?").get(job.id) as {
      status: string;
      attempts: number;
      lease_owner: string | null;
    };
    expect(row).toMatchObject({ status: "pending", attempts: 0, lease_owner: null });
  });
});
