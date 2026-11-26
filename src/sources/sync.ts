import { randomUUID } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { createProposal } from "../knowledge/publish.js";
import { sha256 } from "../shared/hash.js";
import { iso } from "../shared/time.js";
import { readSecret } from "../secrets/store.js";
import { fetchGithubSnapshot, type FetchImpl } from "./github.js";
import { collectLocal, type LocalFile, type Skipped } from "./local.js";
import { getSource, type SourceRow } from "./registry.js";
import { pinnedConnect, safeFetch } from "./url.js";
import { lookup } from "node:dns/promises";

export type SyncDeps = { nowMs: number; fetchImpl?: FetchImpl };

export function syncSource(db: VivaDb, sourceId: string, deps: SyncDeps) {
  const source = getSource(db, sourceId);
  if (source.kind !== "local") throw new Error("async_source");
  const config = JSON.parse(source.config_json) as { root?: string };
  const collected = collectLocal(config.root ?? "");
  const cursor = sha256(collected.files.map((file) => file.path + sha256(file.text)).join("|"));
  return applySnapshot(db, source, collected.files, [], collected.skipped, cursor, { provider: "local", root: config.root, fetchedAt: iso(deps.nowMs) }, deps.nowMs);
}

export async function syncAny(db: VivaDb, sourceId: string, deps: SyncDeps) {
  const source = getSource(db, sourceId);
  if (source.kind === "local") return syncSource(db, sourceId, deps);
  const loaded = await loadSnapshot(db, source, deps);
  return applySnapshot(db, source, loaded.files, loaded.removed, loaded.skipped, loaded.cursor, loaded.provenance, deps.nowMs);
}

export function applySnapshot(db: VivaDb, source: SourceRow, files: LocalFile[], removed: string[], skipped: Skipped[], cursor: string, provenance: unknown, nowMs: number) {
  const manifest = files.map((file) => `${file.path}\0${sha256(file.text)}`).join("\n");
  const checksum = sha256(`${manifest}\nremoved:${removed.slice().sort().join("\n")}`);
  const previous = db.prepare("SELECT * FROM source_revisions WHERE source_id = ? ORDER BY created_at DESC LIMIT 1").get(source.id) as { id: string; checksum: string } | undefined;
  if (previous && previous.checksum === checksum) {
    touchCheckpoint(db, source.id, cursor, nowMs, null);
    return { documents: files.length, proposals: 0, skipped, unchanged: true, revisionId: previous.id };
  }
  const revisionId = randomUUID();
  db.prepare("INSERT INTO source_revisions (id, source_id, checksum, cursor, provenance_json, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    revisionId,
    source.id,
    checksum,
    cursor,
    JSON.stringify(provenance),
    iso(nowMs),
  );
  const previousDocs = previous
    ? db.prepare("SELECT path, text, checksum, title FROM documents WHERE revision_id = ? AND deleted = 0").all(previous.id) as { path: string; text: string; checksum: string; title: string }[]
    : [];
  const seen = new Set(files.map((file) => file.path));
  for (const file of files) {
    const title = titleOf(file.path, file.text);
    db.prepare(`INSERT INTO documents
      (id, workspace_id, source_id, revision_id, path, title, checksum, byte_size, text, deleted, created_at)
      VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, 0, ?)`).run(
      randomUUID(),
      source.id,
      revisionId,
      file.path,
      title,
      sha256(file.text),
      Buffer.byteLength(file.text),
      file.text,
      iso(nowMs),
    );
  }
  let proposals = 0;
  for (const file of files) {
    const key = `${source.id}:${file.path}`;
    const published = db.prepare("SELECT title, text, checksum, revision_id FROM published_chunks WHERE document_key = ?").get(key) as { title: string; text: string; checksum: string; revision_id: string | null } | undefined;
    const checksumOfFile = sha256(file.text);
    const title = titleOf(file.path, file.text);
    const conflict = findConflict(db, source.id, title, checksumOfFile);
    if (published && published.checksum === checksumOfFile && !conflict) continue;
    const kind = conflict ? "conflict" : published ? "stale" : "change";
    const created = createProposal(db, {
      sourceId: source.id,
      kind,
      title,
      documentPath: file.path,
      documentKey: key,
      baseText: published?.text ?? "",
      candidateText: file.text,
      baseRevisionId: published?.revision_id ?? null,
      candidateRevisionId: revisionId,
      evidence: { untrusted: true, sourceId: source.id, path: file.path, kind, conflict },
      idempotencyKey: `propose:${source.id}:${file.path}:${published?.checksum ?? ""}:${checksumOfFile}:${kind}`,
    }, nowMs);
    if (created.created) proposals += 1;
  }
  const gone = [...new Set(previousDocs.map((doc) => doc.path).filter((filePath) => !seen.has(filePath)).concat(removed))];
  for (const filePath of gone) {
    const key = `${source.id}:${filePath}`;
    const published = db.prepare("SELECT title, text, checksum, revision_id FROM published_chunks WHERE document_key = ?").get(key) as { title: string; text: string; checksum: string; revision_id: string | null } | undefined;
    if (!published) continue;
    const created = createProposal(db, {
      sourceId: source.id,
      kind: "removal",
      title: published.title,
      documentPath: filePath,
      documentKey: key,
      baseText: published.text,
      candidateText: "",
      baseRevisionId: published.revision_id,
      candidateRevisionId: revisionId,
      evidence: { untrusted: true, sourceId: source.id, path: filePath, kind: "removal" },
      idempotencyKey: `propose:${source.id}:${filePath}:${published.checksum}:removed:removal`,
    }, nowMs);
    if (created.created) proposals += 1;
    db.prepare(`INSERT INTO documents
      (id, workspace_id, source_id, revision_id, path, title, checksum, byte_size, text, deleted, created_at)
      VALUES (?, 'local', ?, ?, ?, ?, ?, 0, '', 1, ?)`).run(randomUUID(), source.id, revisionId, filePath, published.title, published.checksum, iso(nowMs));
  }
  touchCheckpoint(db, source.id, cursor, nowMs, null);
  return { documents: files.length, proposals, skipped, unchanged: false, revisionId };
}

async function loadSnapshot(db: VivaDb, source: SourceRow, deps: SyncDeps) {
  const config = JSON.parse(source.config_json) as { root?: string; owner?: string; repo?: string; ref?: string; url?: string };
  const checkpoint = db.prepare("SELECT cursor FROM checkpoints WHERE source_id = ?").get(source.id) as { cursor: string | null } | undefined;
  if (source.kind === "local") {
    const collected = collectLocal(config.root ?? "");
    const cursor = sha256(collected.files.map((file) => file.path + sha256(file.text)).join("|"));
    return { ...collected, removed: [] as string[], cursor, provenance: { provider: "local", root: config.root, fetchedAt: iso(deps.nowMs) } };
  }
  if (source.kind === "github") {
    const snapshot = await fetchGithubSnapshot(
      { owner: config.owner ?? "", repo: config.repo ?? "", ref: config.ref ?? "main", cursor: checkpoint?.cursor },
      { token: readSecret(db.dataDir, source.secret_ref), fetchImpl: deps.fetchImpl ?? fetch },
    );
    if (snapshot.unchanged) {
      return { files: previousFiles(db, source.id), removed: [] as string[], skipped: [] as Skipped[], cursor: snapshot.cursor, provenance: { provider: "github", unchanged: true } };
    }
    return { files: snapshot.files, removed: snapshot.removed, skipped: [] as Skipped[], cursor: snapshot.cursor, provenance: { provider: "github", repo: `${config.owner}/${config.repo}`, ref: config.ref, sha: snapshot.cursor, fetchedAt: iso(deps.nowMs) } };
  }
  const fetched = await safeFetch(config.url ?? "", {
    connect: pinnedConnect,
    resolver: async (host) => (await lookup(host, { all: true })).map((item) => item.address),
  });
  const filePath = "page.txt";
  return {
    files: [{ path: filePath, text: fetched.text }],
    removed: [] as string[],
    skipped: [] as Skipped[],
    cursor: sha256(fetched.text),
    provenance: { provider: "url", url: fetched.url, fetchedAt: iso(deps.nowMs) },
  };
}

function previousFiles(db: VivaDb, sourceId: string) {
  const revision = db.prepare("SELECT id FROM source_revisions WHERE source_id = ? ORDER BY created_at DESC LIMIT 1").get(sourceId) as { id: string } | undefined;
  if (!revision) return [];
  return db.prepare("SELECT path, text FROM documents WHERE revision_id = ? AND deleted = 0").all(revision.id) as LocalFile[];
}

function findConflict(db: VivaDb, sourceId: string, title: string, checksum: string) {
  const rows = db.prepare("SELECT source_id, title, checksum, path FROM published_chunks WHERE workspace_id = 'local'").all() as { source_id: string | null; title: string; checksum: string; path: string }[];
  const normalized = normalizeTitle(title);
  return rows.find((row) => row.source_id !== sourceId && normalizeTitle(row.title) === normalized && row.checksum !== checksum) ?? null;
}

function touchCheckpoint(db: VivaDb, sourceId: string, cursor: string, nowMs: number, error: string | null) {
  const stamp = iso(nowMs);
  db.prepare(`INSERT INTO checkpoints (source_id, cursor, last_success_at, last_attempt_at, last_error)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_id) DO UPDATE SET cursor = excluded.cursor, last_success_at = excluded.last_success_at, last_attempt_at = excluded.last_attempt_at, last_error = excluded.last_error`).run(
    sourceId,
    cursor,
    error ? null : stamp,
    stamp,
    error,
  );
}

export function titleOf(filePath: string, text: string) {
  const heading = text.split(/\r?\n/).find((line) => /^#\s+/.test(line));
  if (heading) return heading.replace(/^#\s+/, "").trim();
  return filePath;
}

function normalizeTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}
