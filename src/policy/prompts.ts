import { randomUUID } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { searchPublished } from "../knowledge/retrieve.js";
import { VivaError } from "../shared/errors.js";
import { iso } from "../shared/time.js";

export function proposePrompt(db: VivaDb, input: { name: string; body: string; nowMs: number }) {
  const active = db.prepare("SELECT id FROM prompt_versions WHERE workspace_id = 'local' AND status = 'active'").get() as { id: string };
  const id = randomUUID();
  db.prepare(`INSERT INTO prompt_versions (id, workspace_id, name, body, status, parent_id, eval_json, created_at)
    VALUES (?, 'local', ?, ?, 'candidate', ?, NULL, ?)`).run(id, input.name, input.body, active.id, iso(input.nowMs));
  return { id, name: input.name };
}

export const HELD_OUT = [
  { query: "不是向量搜索", expectPath: "retrieval.md" },
] as const;

export function evaluatePrompt(db: VivaDb, id: string, nowMs: number) {
  const row = db.prepare("SELECT * FROM prompt_versions WHERE id = ?").get(id) as { id: string; body: string };
  const active = db.prepare("SELECT body FROM prompt_versions WHERE workspace_id = 'local' AND status = 'active'").get() as { body: string };
  const leaked = promptLeaks(row.body);
  const activeLeaked = promptLeaks(active.body);
  const score = leaked ? 0 : heldOutScore(db);
  const activeScore = activeLeaked ? 0 : heldOutScore(db);
  const safety = row.body.includes("ABSTAIN") && row.body.includes("不可信");
  const activeSafety = active.body.includes("ABSTAIN") && active.body.includes("不可信");
  const gate = safety && activeSafety && score >= activeScore ? "open" : "blocked";
  const report = { score, activeScore, gate, safety, leaked, heldOut: HELD_OUT.map((item) => item.query), at: iso(nowMs) };
  db.prepare("UPDATE prompt_versions SET eval_json = ? WHERE id = ?").run(JSON.stringify(report), id);
  return report;
}

function promptLeaks(body: string) {
  return HELD_OUT.some((item) => body.includes(item.query) || body.includes(item.expectPath));
}

function heldOutScore(db: VivaDb) {
  let hits = 0;
  for (const item of HELD_OUT) {
    const found = searchPublished(db, item.query);
    if (found.hits.some((hit) => hit.path.includes(item.expectPath))) hits += 1;
  }
  return hits / HELD_OUT.length;
}

export function activatePrompt(db: VivaDb, id: string, nowMs: number) {
  const row = db.prepare("SELECT * FROM prompt_versions WHERE id = ?").get(id) as { id: string; status: string; eval_json: string | null; name: string };
  const report = row.eval_json ? JSON.parse(row.eval_json) as { gate?: string } : null;
  if (!report || report.gate !== "open") throw new VivaError("gate_blocked");
  db.prepare("UPDATE prompt_versions SET status = 'retired' WHERE workspace_id = 'local' AND status = 'active'").run();
  db.prepare("UPDATE prompt_versions SET status = 'active' WHERE id = ?").run(id);
  db.prepare("UPDATE policies SET active_prompt_id = ? WHERE workspace_id = 'local'").run(id);
  return { id, status: "active", name: row.name, at: iso(nowMs) };
}

export function rollbackPrompt(db: VivaDb, nowMs: number) {
  const current = db.prepare("SELECT id FROM prompt_versions WHERE workspace_id = 'local' AND status = 'active'").get() as { id: string };
  const previous = db.prepare("SELECT id, name FROM prompt_versions WHERE workspace_id = 'local' AND status = 'retired' ORDER BY created_at DESC LIMIT 1").get() as { id: string; name: string };
  db.prepare("UPDATE prompt_versions SET status = 'retired' WHERE id = ?").run(current.id);
  db.prepare("UPDATE prompt_versions SET status = 'active' WHERE id = ?").run(previous.id);
  db.prepare("UPDATE policies SET active_prompt_id = ? WHERE workspace_id = 'local'").run(previous.id);
  return { id: previous.id, name: previous.name, at: iso(nowMs) };
}

