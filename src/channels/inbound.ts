import type { VivaDb } from "../db/database.js";
import { createProposal } from "../knowledge/publish.js";

export function acceptChannelText(db: VivaDb, kind: string, eventId: string, text: string, nowMs: number) {
  return createProposal(db, {
    sourceId: null,
    kind: "channel",
    title: kind === "feishu" ? "来自飞书的待审消息" : "来自钉钉的待审消息",
    documentPath: null,
    documentKey: null,
    baseText: "",
    candidateText: text,
    evidence: { untrusted: true, channel: kind, eventId },
    idempotencyKey: `channel:${kind}:${eventId}`,
  }, nowMs);
}
