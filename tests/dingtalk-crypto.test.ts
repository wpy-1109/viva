import { createDecipheriv, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { dingTalkAesKey, dingTalkDecrypt, dingTalkEncrypt, dingTalkMsgSignature } from "../src/channels/dingtalkCrypto.js";
import { verifyDingTalk } from "../src/channels/dingtalk.js";
import { openDatabase } from "../src/db/database.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const aesKey = randomBytes(32).toString("base64").replace(/=+$/, "");
const token = "callback-token";
const now = Date.parse("2026-11-25T12:00:00Z");

function independentDecrypt(encodingAesKey: string, encrypt: string) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(Buffer.from(encrypt, "base64")), decipher.final()]);
  const pad = padded[padded.length - 1];
  const content = padded.subarray(0, padded.length - pad);
  const length = content.readUInt32BE(16);
  return content.subarray(20, 20 + length).toString("utf8");
}

describe("dingtalk encrypted callback", () => {
  it("matches an independent decrypt and rejects bad signature, time, padding, and replay", () => {
    expect(dingTalkAesKey(aesKey).length).toBe(32);
    const plaintext = JSON.stringify({ eventId: "enc-1", text: "加密回调里的待审句子" });
    const encrypt = dingTalkEncrypt(aesKey, plaintext, "suite");
    expect(independentDecrypt(aesKey, encrypt)).toBe(plaintext);
    expect(dingTalkDecrypt(aesKey, encrypt)).toBe(plaintext);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viva-ding-"));
    const db = openDatabase(dir);
    const timestamp = String(now);
    const nonce = "n-enc";
    const signature = dingTalkMsgSignature(token, timestamp, nonce, encrypt);
    const headers = { timestamp, nonce, msg_signature: signature, sign: "ignored" };
    const body = JSON.stringify({ encrypt });
    const first = verifyDingTalk(db, body, headers, "robot-secret", now, { token, encodingAesKey: aesKey });
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.text).toContain("待审句子");
    expect(verifyDingTalk(db, body, headers, "robot-secret", now, { token, encodingAesKey: aesKey }).ok).toBe(false);
    expect(verifyDingTalk(db, body, { ...headers, msg_signature: "0".repeat(40) }, "robot-secret", now, { token, encodingAesKey: aesKey })).toMatchObject({ reason: "bad_signature" });
    expect(verifyDingTalk(db, body, headers, "robot-secret", now + 10 * 60 * 1000, { token, encodingAesKey: aesKey })).toMatchObject({ reason: "timestamp_expired" });
    const broken = `${encrypt.slice(0, -4)}AAAA`;
    expect(verifyDingTalk(db, JSON.stringify({ encrypt: broken }), { ...headers, msg_signature: dingTalkMsgSignature(token, timestamp, nonce, broken) }, "robot-secret", now, { token, encodingAesKey: aesKey }).ok).toBe(false);
    db.close();
  });
});
