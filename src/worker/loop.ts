import type { VivaDb } from "../db/database.js";
import { beat, getDesiredState } from "../control/state.js";
import { claim, enqueue, fail, releaseOwnedLeases, succeed, type JobRow } from "../jobs/queue.js";
import { listSources } from "../sources/registry.js";
import { syncAny } from "../sources/sync.js";
import type { FetchImpl } from "../sources/github.js";

export async function workerTick(db: VivaDb, input: { owner: string; nowMs: number; fetchImpl: FetchImpl; concurrency?: number }) {
  const desired = getDesiredState(db);
  beat(db, "worker", desired === "running" ? "running" : "idle", input.nowMs, desired);
  if (desired !== "running") {
    releaseOwnedLeases(db, input.owner, input.nowMs);
    return { claimed: 0, desired };
  }
  scheduleDue(db, input.nowMs);
  let claimed = 0;
  const limit = Math.min(input.concurrency ?? 2, 4);
  for (let round = 0; round < 4; round += 1) {
    const jobs = claim(db, { owner: input.owner, nowMs: input.nowMs, leaseMs: 30_000, limit });
    if (jobs.length === 0) break;
    claimed += jobs.length;
    for (const job of jobs) {
      try {
        await handle(db, job, input.nowMs, input.fetchImpl);
        succeed(db, job.id, input.nowMs);
      } catch (error) {
        fail(db, job.id, error instanceof Error ? error.message : "job_failed", input.nowMs);
      }
    }
  }
  return { claimed, desired };
}

function scheduleDue(db: VivaDb, nowMs: number) {
  for (const source of listSources(db)) {
    if (!source.enabled) continue;
    const checkpoint = db.prepare("SELECT last_success_at FROM checkpoints WHERE source_id = ?").get(source.id) as { last_success_at: string | null } | undefined;
    const last = checkpoint?.last_success_at ? Date.parse(checkpoint.last_success_at) : 0;
    if (nowMs - last < source.interval_seconds * 1000) continue;
    enqueue(db, {
      type: "source.sync",
      idempotencyKey: `sync:${source.id}:${checkpoint?.last_success_at ?? "initial"}`,
      payload: { sourceId: source.id },
      nowMs,
      reviveTerminal: true,
    });
  }
}

async function handle(db: VivaDb, job: JobRow, nowMs: number, fetchImpl: FetchImpl) {
  const payload = JSON.parse(job.payload_json) as { sourceId?: string };
  if (job.type === "source.sync") {
    if (!payload.sourceId) throw new Error("missing_source");
    await syncAny(db, payload.sourceId, { nowMs, fetchImpl });
    return;
  }
  if (job.type === "noop" || job.type === "knowledge.propose") return;
  throw new Error(`unknown_job:${job.type}`);
}
