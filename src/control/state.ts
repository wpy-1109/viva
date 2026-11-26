import type { VivaDb } from "../db/database.js";
import { audit } from "../db/database.js";
import { readSecret, writeSecret } from "../secrets/store.js";
import { iso } from "../shared/time.js";

const MODEL_REF = "model:local";

export function getDesiredState(db: VivaDb) {
  const row = db.prepare("SELECT value FROM control WHERE workspace_id = 'local' AND key = 'desired'").get() as { value: string };
  return row.value;
}

export function setDesiredState(db: VivaDb, desired: "running" | "stopped", nowMs: number) {
  db.prepare(`INSERT INTO control (workspace_id, key, value, updated_at)
    VALUES ('local', 'desired', ?, ?)
    ON CONFLICT(workspace_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`).run(desired, iso(nowMs));
  audit(db, "autopilot.desired", { desired }, nowMs);
  return desired;
}

export type Policy = {
  autopublish_enabled: number;
  autopublish_max_lines: number;
  autopublish_kinds: string;
  github_publish_enabled: number;
  active_prompt_id: string | null;
  max_calls_per_run: number;
  max_tokens_per_call: number;
  max_estimated_usd: number;
  usd_per_1k_tokens: number;
};

export function getPolicy(db: VivaDb) {
  return db.prepare("SELECT * FROM policies WHERE workspace_id = 'local'").get() as Policy;
}

export function setPolicy(db: VivaDb, input: { autopublishEnabled?: boolean; autopublishMaxLines?: number; githubPublishEnabled?: boolean; nowMs: number }) {
  const current = getPolicy(db);
  db.prepare(`UPDATE policies SET autopublish_enabled = ?, autopublish_max_lines = ?, github_publish_enabled = ? WHERE workspace_id = 'local'`).run(
    input.autopublishEnabled === undefined ? current.autopublish_enabled : Number(input.autopublishEnabled),
    input.autopublishMaxLines ?? current.autopublish_max_lines,
    input.githubPublishEnabled === undefined ? current.github_publish_enabled : Number(input.githubPublishEnabled),
  );
  audit(db, "policy.update", { autopublishEnabled: input.autopublishEnabled, githubPublishEnabled: input.githubPublishEnabled }, input.nowMs);
  return getPolicy(db);
}

export function saveModel(db: VivaDb, input: { mode: "demo" | "live"; baseUrl?: string | null; model?: string | null; apiKey?: string | null; nowMs: number }) {
  let secretRef: string | null = (db.prepare("SELECT secret_ref FROM model_config WHERE workspace_id = 'local'").get() as { secret_ref: string | null }).secret_ref;
  if (input.apiKey) {
    writeSecret(db.dataDir, MODEL_REF, input.apiKey);
    secretRef = MODEL_REF;
  }
  if (input.apiKey === "") {
    secretRef = null;
  }
  db.prepare(`UPDATE model_config SET mode = ?, base_url = ?, model = ?, secret_ref = ? WHERE workspace_id = 'local'`).run(
    input.mode,
    input.baseUrl ?? null,
    input.model ?? null,
    secretRef,
  );
  audit(db, "model.save", { mode: input.mode, baseUrl: input.baseUrl, model: input.model, hasKey: Boolean(secretRef) }, input.nowMs);
  return publicModel(db);
}

export function publicModel(db: VivaDb) {
  const row = db.prepare("SELECT mode, base_url, model, secret_ref, protocol FROM model_config WHERE workspace_id = 'local'").get() as {
    mode: string;
    base_url: string | null;
    model: string | null;
    secret_ref: string | null;
    protocol: string;
  };
  return {
    mode: row.mode,
    baseUrl: row.base_url,
    model: row.model,
    protocol: row.protocol,
    hasKey: Boolean(row.secret_ref && readSecret(db.dataDir, row.secret_ref)),
  };
}

export function readModelKey(db: VivaDb) {
  const row = db.prepare("SELECT secret_ref FROM model_config WHERE workspace_id = 'local'").get() as { secret_ref: string | null };
  return readSecret(db.dataDir, row.secret_ref);
}

export function beat(db: VivaDb, role: string, status: string, nowMs: number, detail = "") {
  db.prepare(`INSERT INTO heartbeats (workspace_id, role, pid, status, last_seen, detail)
    VALUES ('local', ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, role) DO UPDATE SET pid = excluded.pid, status = excluded.status, last_seen = excluded.last_seen, detail = excluded.detail`).run(
    role,
    process.pid,
    status,
    iso(nowMs),
    detail,
  );
}
