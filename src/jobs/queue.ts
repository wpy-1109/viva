import { randomUUID } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { iso } from "../shared/time.js";

export type JobRow = {
  id: string;
  workspace_id: string;
  type: string;
  status: string;
  idempotency_key: string;
  payload_json: string;
  attempts: number;
  max_attempts: number;
  run_after: string;
  lease_owner: string | null;
  lease_until: string | null;
  last_error: string | null;
  cancel_requested: number;
  created_at: string;
  updated_at: string;
};

const WORKSPACE = "local";

export function enqueue(db: VivaDb, input: {
  type: string;
  idempotencyKey: string;
  payload: unknown;
  nowMs: number;
  maxAttempts?: number;
  reviveTerminal?: boolean;
}) {
  const existing = db.prepare("SELECT * FROM jobs WHERE workspace_id = ? AND idempotency_key = ?").get(WORKSPACE, input.idempotencyKey) as JobRow | undefined;
  if (existing) {
    if (input.reviveTerminal && (existing.status === "failed" || existing.status === "cancelled")) {
      db.prepare(`UPDATE jobs
        SET status = 'pending', attempts = 0, last_error = NULL, cancel_requested = 0,
            lease_owner = NULL, lease_until = NULL, run_after = ?, updated_at = ?
        WHERE id = ?`).run(iso(input.nowMs), iso(input.nowMs), existing.id);
      return { job: getJob(db, existing.id), created: false, revived: true };
    }
    return { job: existing, created: false, revived: false };
  }
  const id = randomUUID();
  const stamp = iso(input.nowMs);
  db.prepare(`INSERT INTO jobs
    (id, workspace_id, type, status, idempotency_key, payload_json, attempts, max_attempts, run_after, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, 0, ?, ?, ?, ?)`).run(
    id,
    WORKSPACE,
    input.type,
    input.idempotencyKey,
    JSON.stringify(input.payload ?? {}),
    input.maxAttempts ?? 5,
    stamp,
    stamp,
    stamp,
  );
  event(db, id, input.nowMs, "info", "已入队");
  return { job: getJob(db, id), created: true, revived: false };
}

export function claim(db: VivaDb, input: { owner: string; nowMs: number; leaseMs: number; limit: number }) {
  const taken: JobRow[] = [];
  const select = db.prepare(`SELECT id FROM jobs
    WHERE workspace_id = ?
      AND cancel_requested = 0
      AND (
        (status = 'pending' AND run_after <= ?)
        OR (status = 'leased' AND lease_until <= ?)
      )
    ORDER BY run_after ASC, created_at ASC
    LIMIT 1`);
  const update = db.prepare(`UPDATE jobs
    SET status = 'leased', lease_owner = ?, lease_until = ?, attempts = attempts + 1, updated_at = ?
    WHERE id = ? AND cancel_requested = 0 AND (
      (status = 'pending' AND run_after <= ?)
      OR (status = 'leased' AND lease_until <= ?)
    )`);
  const run = db.transaction(() => {
    for (let index = 0; index < input.limit; index += 1) {
      const now = iso(input.nowMs);
      const row = select.get(WORKSPACE, now, now) as { id: string } | undefined;
      if (!row) break;
      const changed = update.run(input.owner, iso(input.nowMs + input.leaseMs), now, row.id, now, now);
      if (changed.changes === 1) taken.push(getJob(db, row.id));
    }
  });
  run.immediate();
  for (const job of taken) event(db, job.id, input.nowMs, "info", `由 ${input.owner} 认领`);
  return taken;
}

export function succeed(db: VivaDb, id: string, nowMs: number) {
  const changed = db.prepare(`UPDATE jobs
    SET status = 'succeeded', lease_owner = NULL, lease_until = NULL, updated_at = ?, last_error = NULL
    WHERE id = ? AND status = 'leased'`).run(iso(nowMs), id);
  if (changed.changes === 1) event(db, id, nowMs, "info", "已完成");
  return getJob(db, id);
}

export function fail(db: VivaDb, id: string, message: string, nowMs: number) {
  const job = getJob(db, id);
  const stamp = iso(nowMs);
  if (job.status === "cancelled") return job;
  if (job.attempts >= job.max_attempts) {
    db.prepare(`UPDATE jobs
      SET status = 'failed', lease_owner = NULL, lease_until = NULL, last_error = ?, updated_at = ?
      WHERE id = ? AND status = 'leased'`).run(message, stamp, id);
    event(db, id, nowMs, "error", "已失败", { error: message });
    return getJob(db, id);
  }
  const delay = 2 ** job.attempts * 1000;
  const retried = db.prepare(`UPDATE jobs
    SET status = 'pending', lease_owner = NULL, lease_until = NULL, last_error = ?, run_after = ?, updated_at = ?
    WHERE id = ? AND status = 'leased'`).run(message, iso(nowMs + delay), stamp, id);
  if (retried.changes === 0) return getJob(db, id);
  event(db, id, nowMs, "warn", "将重试", { error: message, delayMs: delay });
  return getJob(db, id);
}

export function cancel(db: VivaDb, id: string, nowMs: number) {
  const job = getJob(db, id);
  if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled") return job;
  db.prepare(`UPDATE jobs
    SET status = 'cancelled', cancel_requested = 1, lease_owner = NULL, lease_until = NULL, updated_at = ?
    WHERE id = ? AND status IN ('pending', 'leased')`).run(iso(nowMs), id);
  event(db, id, nowMs, "info", "已取消");
  return getJob(db, id);
}

export function releaseOwnedLeases(db: VivaDb, owner: string, nowMs: number) {
  db.prepare(`UPDATE jobs
    SET status = 'pending',
        attempts = CASE WHEN attempts > 0 THEN attempts - 1 ELSE 0 END,
        lease_owner = NULL,
        lease_until = NULL,
        updated_at = ?
    WHERE status = 'leased' AND lease_owner = ?`).run(iso(nowMs), owner);
}

export function counts(db: VivaDb) {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM jobs WHERE workspace_id = ? GROUP BY status").all(WORKSPACE) as { status: string; n: number }[];
  const result = { pending: 0, leased: 0, succeeded: 0, failed: 0, cancelled: 0 };
  for (const row of rows) {
    if (row.status in result) result[row.status as keyof typeof result] = row.n;
  }
  return result;
}

export function getJob(db: VivaDb, id: string) {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined;
  if (!row) throw new Error("job_not_found");
  return row;
}

export function listJobs(db: VivaDb, limit = 50) {
  return db.prepare("SELECT * FROM jobs WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?").all(WORKSPACE, limit) as JobRow[];
}

export function listEvents(db: VivaDb, jobId: string) {
  return db.prepare("SELECT id, at, level, message, data_json FROM job_events WHERE job_id = ? ORDER BY id").all(jobId);
}

function event(db: VivaDb, jobId: string, nowMs: number, level: string, message: string, data: unknown = {}) {
  db.prepare("INSERT INTO job_events (job_id, at, level, message, data_json) VALUES (?, ?, ?, ?, ?)").run(
    jobId,
    iso(nowMs),
    level,
    message,
    JSON.stringify(data),
  );
}
