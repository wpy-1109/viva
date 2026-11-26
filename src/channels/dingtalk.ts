import { createHmac } from "node:crypto";
import type { VivaDb } from "../db/database.js";
import { dingTalkDecrypt, dingTalkMsgSignature, signaturesMatch } from "./dingtalkCrypto.js";
import { header, remember, safeEqual, seen } from "./feishu.js";

const WINDOW_MS = 5 * 60 * 1000;

export function dingtalkSign(timestamp: string, secret: string) {
  return createHmac("sha256", secret).update(`${timestamp}\n${secret}`).digest("base64");
}

export function verifyDingTalk(db: VivaDb, rawBody: string, headers: Record<string, string | undefined>, secret: string, nowMs: number, encrypted?: { token?: string; encodingAesKey?: string }) {
  let parsed: any;
  try {
    parsed = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return { ok: false as const, reason: "bad_json" };
  }
  if (parsed.encrypt || header(headers, "msg_signature") || header(headers, "msg-signature")) {
    return verifyEncryptedDingTalk(db, parsed, headers, nowMs, encrypted);
  }
  const timestamp = header(headers, "timestamp");
  const sign = header(headers, "sign");
  if (!timestamp || !sign) return { ok: false as const, reason: "missing_signature" };
  const expected = dingtalkSign(timestamp, secret);
  const decoded = safeDecode(sign);
  if (!safeEqual(expected, sign) && !safeEqual(expected, decoded)) return { ok: false as const, reason: "bad_signature" };
  const numeric = Number(timestamp);
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  if (!Number.isFinite(millis) || Math.abs(nowMs - millis) > WINDOW_MS) return { ok: false as const, reason: "timestamp_expired" };
  const eventId = String(parsed.eventId ?? "");
  if (!eventId) return { ok: false as const, reason: "missing_event_id" };
  if (seen(db, "dingtalk", eventId)) return { ok: false as const, reason: "replay" };
  remember(db, "dingtalk", eventId, nowMs);
  const text = typeof parsed.text === "string" ? parsed.text : JSON.stringify(parsed.data ?? {});
  return { ok: true as const, eventId, text };
}

function verifyEncryptedDingTalk(db: VivaDb, parsed: { encrypt?: string }, headers: Record<string, string | undefined>, nowMs: number, encrypted?: { token?: string; encodingAesKey?: string }) {
  if (!encrypted?.token || !encrypted.encodingAesKey) {
    return {
      ok: false as const,
      reason: "dingtalk_encrypted_callback_unsupported",
      detail: "未配置 EncodingAESKey 与回调 token。明文 HMAC 不能当作加密回调已接通。",
    };
  }
  const timestamp = header(headers, "timestamp") ?? "";
  const nonce = header(headers, "nonce") ?? "";
  const signature = header(headers, "msg_signature") ?? header(headers, "msg-signature") ?? "";
  const numeric = Number(timestamp);
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  if (!Number.isFinite(millis) || Math.abs(nowMs - millis) > WINDOW_MS) return { ok: false as const, reason: "timestamp_expired" };
  const expected = dingTalkMsgSignature(encrypted.token, timestamp, nonce, String(parsed.encrypt));
  if (!signature || !signaturesMatch(expected, signature)) return { ok: false as const, reason: "bad_signature" };
  let text = "";
  try {
    text = dingTalkDecrypt(encrypted.encodingAesKey, String(parsed.encrypt));
  } catch {
    return { ok: false as const, reason: "bad_padding" };
  }
  let inner: { eventId?: string; text?: string } = {};
  try {
    inner = JSON.parse(text) as { eventId?: string; text?: string };
  } catch {
    return { ok: false as const, reason: "bad_json" };
  }
  const eventId = String(inner.eventId ?? "");
  if (!eventId) return { ok: false as const, reason: "missing_event_id" };
  if (seen(db, "dingtalk", eventId)) return { ok: false as const, reason: "replay" };
  remember(db, "dingtalk", eventId, nowMs);
  return { ok: true as const, eventId, text: inner.text ?? text };
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
