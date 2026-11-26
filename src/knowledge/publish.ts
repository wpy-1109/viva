import { randomUUID } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { audit } from "../db/database.js";
import { getPolicy } from "../control/state.js";
import { diffLineCount, unifiedDiff } from "../shared/diffText.js";
import { sha256 } from "../shared/hash.js";
import { iso } from "../shared/time.js";
import { VivaError } from "../shared/errors.js";

export type ProposalDraft = {
  sourceId: string | null;
  kind: string;
  title: string;
  documentPath: string | null;
  documentKey: string | null;
  baseText: string;
  candidateText: string;
  baseRevisionId?: string | null;
  candidateRevisionId?: string | null;
  evidence: unknown;
  idempotencyKey: string;
};

export function createProposal(db: VivaDb, draft: ProposalDraft, nowMs: number) {
  const existing = db.prepare("SELECT * FROM proposals WHERE idempotency_key = ?").get(draft.idempotencyKey) as { id: string } | undefined;
  if (existing) return { proposal: getProposal(db, existing.id), created: false };
  const diff = unifiedDiff(draft.documentPath ?? draft.title, draft.baseText, draft.candidateText);
  const policy = getPolicy(db);
  const allowed = policy.autopublish_kinds.split(",").map((item) => item.trim());
  const autopublish = policy.autopublish_enabled === 1
    && draft.kind === "change"
    && allowed.includes("change")
    && diffLineCount(diff) <= policy.autopublish_max_lines;
  const id = randomUUID();
  db.prepare(`INSERT INTO proposals
    (id, workspace_id, source_id, kind, status, title, document_path, document_key, base_text, candidate_text, diff_text, evidence_json, base_revision_id, candidate_revision_id, idempotency_key, created_at, decided_at, decision_note)
    VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`).run(
    id,
    draft.sourceId,
    draft.kind,
    autopublish ? "approved" : "pending_review",
    draft.title,
    draft.documentPath,
    draft.documentKey,
    draft.baseText,
    draft.candidateText,
    diff,
    JSON.stringify(draft.evidence),
    draft.baseRevisionId ?? null,
    draft.candidateRevisionId ?? null,
    draft.idempotencyKey,
    iso(nowMs),
    autopublish ? iso(nowMs) : null,
  );
  if (autopublish) {
    applyPublication(db, getProposal(db, id), nowMs);
    audit(db, "proposal.autopublish", { id, kind: draft.kind }, nowMs);
  }
  return { proposal: getProposal(db, id), created: true };
}

export function applicability(db: VivaDb, proposal: ProposalRow) {
  if (!proposal.document_key) return { applicable: true, blockReason: null as string | null };
  const current = db.prepare("SELECT checksum FROM published_chunks WHERE document_key = ?").get(proposal.document_key) as { checksum: string } | undefined;
  const baseHash = sha256(proposal.base_text);
  if (!current) return { applicable: proposal.base_text === "", blockReason: proposal.base_text === "" ? null : "base_missing" };
  if (current.checksum !== baseHash) return { applicable: false, blockReason: "superseded" };
  return { applicable: true, blockReason: null };
}

export function publishProposal(db: VivaDb, id: string, nowMs: number) {
  const proposal = getProposal(db, id);
  if (proposal.status === "approved") return proposal;
  if (proposal.status !== "pending_review") throw new VivaError("not_pending");
  const gate = applicability(db, proposal);
  if (!gate.applicable) throw new VivaError(gate.blockReason ?? "superseded");
  applyPublication(db, proposal, nowMs);
  db.prepare("UPDATE proposals SET status = 'approved', decided_at = ? WHERE id = ?").run(iso(nowMs), id);
  const rebased = rebaseNewerPending(db, getProposal(db, id), nowMs);
  audit(db, "proposal.approve", { id, rebasedProposalId: rebased?.proposal.id ?? null }, nowMs);
  return { ...getProposal(db, id), rebasedProposalId: rebased?.proposal.id ?? null };
}

function rebaseNewerPending(db: VivaDb, approved: ProposalRow, nowMs: number) {
  if (!approved.document_key) return null;
  const published = db.prepare("SELECT text, checksum FROM published_chunks WHERE document_key = ?").get(approved.document_key) as { text: string; checksum: string } | undefined;
  if (!published) return null;
  const pending = db.prepare("SELECT * FROM proposals WHERE document_key = ? AND status = 'pending_review' AND id != ? ORDER BY created_at DESC").all(approved.document_key, approved.id) as ProposalRow[];
  const newer = pending.find((item) => sha256(item.candidate_text) !== published.checksum);
  for (const item of pending) {
    db.prepare("UPDATE proposals SET status = 'superseded', decided_at = ?, decision_note = ? WHERE id = ?").run(
      iso(nowMs),
      "基线已变。若仍有更新的来源文本，会另生成一份可审提案。",
      item.id,
    );
  }
  if (!newer) return null;
  return createProposal(db, {
    sourceId: newer.source_id,
    kind: "stale",
    title: newer.title,
    documentPath: newer.document_path,
    documentKey: newer.document_key,
    baseText: published.text,
    candidateText: newer.candidate_text,
    baseRevisionId: approved.candidate_revision_id,
    candidateRevisionId: newer.candidate_revision_id,
    evidence: { untrusted: true, rebaseOf: newer.id, approvedProposalId: approved.id, reason: "refresh_after_older_publish" },
    idempotencyKey: `rebase:${approved.id}:${newer.id}:${published.checksum}:${sha256(newer.candidate_text)}`,
  }, nowMs);
}

export function rejectProposal(db: VivaDb, id: string, nowMs: number, note = "") {
  const proposal = getProposal(db, id);
  if (proposal.status !== "pending_review") throw new VivaError("not_pending");
  db.prepare("UPDATE proposals SET status = 'rejected', decided_at = ?, decision_note = ? WHERE id = ?").run(iso(nowMs), note, id);
  audit(db, "proposal.reject", { id }, nowMs);
  return getProposal(db, id);
}

export function rollbackPublished(db: VivaDb, documentPath: string, sourceId: string, nowMs: number) {
  const key = `${sourceId}:${documentPath}`;
  const history = db.prepare("SELECT * FROM published_history WHERE document_key = ? ORDER BY published_at DESC, id DESC").all(key) as HistoryRow[];
  if (history.length < 2) throw new VivaError("nothing_to_rollback");
  const previous = history[1];
  db.prepare("DELETE FROM published_chunks WHERE document_key = ?").run(key);
  db.prepare(`INSERT INTO published_chunks
    (workspace_id, document_key, source_id, revision_id, path, title, text, checksum)
    VALUES ('local', ?, ?, ?, ?, ?, ?, ?)`).run(key, previous.source_id, previous.revision_id, previous.path, previous.title, previous.text, previous.checksum);
  audit(db, "knowledge.rollback", { documentKey: key }, nowMs);
  return { checksum: previous.checksum, text: previous.text };
}

function applyPublication(db: VivaDb, proposal: ProposalRow, nowMs: number) {
  if (!proposal.document_key || !proposal.document_path) return;
  db.prepare("DELETE FROM published_chunks WHERE document_key = ?").run(proposal.document_key);
  const checksum = sha256(proposal.candidate_text);
  if (proposal.kind !== "removal") {
    db.prepare(`INSERT INTO published_chunks
      (workspace_id, document_key, source_id, revision_id, path, title, text, checksum)
      VALUES ('local', ?, ?, ?, ?, ?, ?, ?)`).run(
      proposal.document_key,
      proposal.source_id,
      proposal.candidate_revision_id,
      proposal.document_path,
      proposal.title,
      proposal.candidate_text,
      checksum,
    );
  }
  db.prepare(`INSERT INTO published_history
    (id, workspace_id, document_key, source_id, revision_id, path, title, text, checksum, published_at)
    VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    randomUUID(),
    proposal.document_key,
    proposal.source_id,
    proposal.candidate_revision_id,
    proposal.document_path,
    proposal.title,
    proposal.kind === "removal" ? "" : proposal.candidate_text,
    checksum,
    iso(nowMs),
  );
}

export type ProposalRow = {
  id: string;
  source_id: string | null;
  kind: string;
  status: string;
  title: string;
  document_path: string | null;
  document_key: string | null;
  base_text: string;
  candidate_text: string;
  diff_text: string;
  evidence_json: string;
  base_revision_id: string | null;
  candidate_revision_id: string | null;
  idempotency_key: string;
  created_at: string;
  decided_at: string | null;
};

type HistoryRow = {
  source_id: string | null;
  revision_id: string | null;
  path: string;
  title: string;
  text: string;
  checksum: string;
};

export function getProposal(db: VivaDb, id: string) {
  const row = db.prepare("SELECT * FROM proposals WHERE id = ?").get(id) as ProposalRow | undefined;
  if (!row) throw new VivaError("proposal_not_found");
  return row;
}

export function listProposals(db: VivaDb) {
  return db.prepare("SELECT * FROM proposals WHERE workspace_id = 'local' ORDER BY created_at DESC").all() as ProposalRow[];
}
