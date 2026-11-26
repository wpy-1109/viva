import { createDecipheriv, createHash, timingSafeEqual } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { iso } from "../shared/time.js";

const WINDOW_MS = 5 * 60 * 1000;

export function feishuSignature(timestamp: string, nonce: string, encryptKey: string, body: string) {
  return createHash("sha256").update(`${timestamp}${nonce}${encryptKey}${body}`).digest("hex");
}

export function decryptFeishu(encrypt: string, key: string) {
  const hashed = createHash("sha256").update(key).digest();
  const buffer = Buffer.from(encrypt, "base64");
  const decipher = createDecipheriv("aes-256-cbc", hashed, buffer.subarray(0, 16));
  const plain = Buffer.concat([decipher.update(buffer.subarray(16)), decipher.final()]);
  return plain.toString("utf8");
}

export function verifyFeishu(db: VivaDb, rawBody: string, headers: Record<string, string | undefined>, secret: { encryptKey: string }, nowMs: number) {
  if (!secret.encryptKey) return { ok: false as const, reason: "not_configured" };
  const timestamp = header(headers, "x-lark-request-timestamp");
  const nonce = header(headers, "x-lark-request-nonce");
  const signature = header(headers, "x-lark-signature");
  if (!timestamp || !nonce || !signature) return { ok: false as const, reason: "missing_signature" };
  const expected = feishuSignature(timestamp, nonce, secret.encryptKey, rawBody);
  if (!safeEqual(expected, signature)) return { ok: false as const, reason: "bad_signature" };
  const skew = Math.abs(nowMs - Number(timestamp) * 1000);
  if (!Number.isFinite(skew) || skew > WINDOW_MS) return { ok: false as const, reason: "timestamp_expired" };
  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return { ok: false as const, reason: "bad_json" };
  }
  if (parsed.encrypt) {
    const inner = decryptFeishu(String(parsed.encrypt), secret.encryptKey);
    parsed = JSON.parse(inner);
  }
  if (parsed.type === "url_verification") return { ok: true as const, challenge: String(parsed.challenge ?? ""), eventId: "", text: "" };
  const eventId = String(parsed.header?.event_id ?? parsed.event_id ?? "");
  if (!eventId) return { ok: false as const, reason: "missing_event_id" };
  if (seen(db, "feishu", eventId) || seen(db, "feishu-nonce", nonce)) return { ok: false as const, reason: "replay" };
  remember(db, "feishu", eventId, nowMs);
  remember(db, "feishu-nonce", nonce, nowMs);
  return { ok: true as const, eventId, text: extractText(parsed), challenge: "" };
}

function extractText(parsed: any) {
  const content = parsed.event?.message?.content;
  if (typeof content === "string") {
    try {
      const inner = JSON.parse(content) as { text?: string };
      if (inner.text) return inner.text;
    } catch {
      return content;
    }
  }
  return typeof parsed.text === "string" ? parsed.text : JSON.stringify(parsed.event ?? {});
}

export function header(headers: Record<string, string | undefined>, name: string) {
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
}

export function safeEqual(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function seen(db: VivaDb, kind: string, eventId: string) {
  return Boolean(db.prepare("SELECT id FROM channel_events WHERE workspace_id = 'local' AND kind = ? AND event_id = ?").get(kind, eventId));
}

export function remember(db: VivaDb, kind: string, eventId: string, nowMs: number) {
  db.prepare("INSERT INTO channel_events (id, workspace_id, kind, event_id, received_at) VALUES (?, 'local', ?, ?, ?)").run(
    `${kind}:${eventId}`,
    kind,
    eventId,
    iso(nowMs),
  );
}
