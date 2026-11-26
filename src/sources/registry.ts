import { randomUUID } from "node:crypto";
import path from "node:path";
import type { VivaDb } from "../db/database.js";
import { iso } from "../shared/time.js";
import { writeSecret } from "../secrets/store.js";

export type SourceRow = {
  id: string;
  kind: string;
  name: string;
  config_json: string;
  secret_ref: string | null;
  interval_seconds: number;
  enabled: number;
  deleted_at: string | null;
};

export function createSource(db: VivaDb, input: {
  kind: "local" | "github" | "url";
  name: string;
  root?: string;
  owner?: string;
  repo?: string;
  ref?: string;
  url?: string;
  token?: string;
  hookSecret?: string;
  intervalSeconds?: number;
  nowMs: number;
}) {
  const id = randomUUID();
  if (input.kind === "local") {
    const root = input.root ?? "";
    if (!path.isAbsolute(root) || root.includes("\0")) throw new Error("root_not_absolute");
    const resolved = path.resolve(root);
    if (resolved === path.parse(resolved).root) throw new Error("root_too_broad");
  }
  const config = input.kind === "local"
    ? { root: input.root }
    : input.kind === "github"
      ? { owner: input.owner, repo: input.repo, ref: input.ref ?? "main" }
      : { url: input.url };
  let secretRef: string | null = null;
  if (input.token) {
    secretRef = `source:${id}:token`;
    writeSecret(db.dataDir, secretRef, input.token);
  }
  if (input.hookSecret) {
    const hookRef = `source:${id}:hook`;
    writeSecret(db.dataDir, hookRef, input.hookSecret);
    if (!secretRef) secretRef = hookRef;
  }
  const stamp = iso(input.nowMs);
  db.prepare(`INSERT INTO sources
    (id, workspace_id, kind, name, config_json, secret_ref, interval_seconds, enabled, created_at, updated_at)
    VALUES (?, 'local', ?, ?, ?, ?, ?, 1, ?, ?)`).run(
    id,
    input.kind,
    input.name,
    JSON.stringify(config),
    secretRef,
    input.intervalSeconds ?? 3600,
    stamp,
    stamp,
  );
  return getSource(db, id);
}

export function getSource(db: VivaDb, id: string) {
  const row = db.prepare("SELECT * FROM sources WHERE id = ? AND workspace_id = 'local'").get(id) as SourceRow | undefined;
  if (!row || row.deleted_at) throw new Error("source_not_found");
  return row;
}

export function listSources(db: VivaDb) {
  return db.prepare("SELECT * FROM sources WHERE workspace_id = 'local' AND deleted_at IS NULL ORDER BY created_at").all() as SourceRow[];
}

export function softDeleteSource(db: VivaDb, id: string, nowMs: number) {
  db.prepare("UPDATE sources SET deleted_at = ?, enabled = 0, updated_at = ? WHERE id = ?").run(iso(nowMs), iso(nowMs), id);
}
