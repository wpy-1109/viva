import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

const BLOCK = 32;

export function dingTalkAesKey(encodingAesKey: string) {
  const key = Buffer.from(`${encodingAesKey}=`, "base64");
  if (key.length !== 32) throw new Error("bad_aes_key");
  return key;
}

export function dingTalkMsgSignature(token: string, timestamp: string, nonce: string, encrypt: string) {
  return createHash("sha1").update([token, timestamp, nonce, encrypt].sort().join("")).digest("hex");
}

export function dingTalkEncrypt(encodingAesKey: string, plaintext: string, receiveId: string) {
  const key = dingTalkAesKey(encodingAesKey);
  const message = Buffer.from(plaintext);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(message.length, 0);
  const raw = Buffer.concat([randomBytes(16), length, message, Buffer.from(receiveId)]);
  const pad = BLOCK - (raw.length % BLOCK || BLOCK);
  const padded = Buffer.concat([raw, Buffer.alloc(pad, pad)]);
  const cipher = createCipheriv("aes-256-cbc", key, key.subarray(0, 16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]).toString("base64");
}

export function dingTalkDecrypt(encodingAesKey: string, encrypt: string) {
  const key = dingTalkAesKey(encodingAesKey);
  const decipher = createDecipheriv("aes-256-cbc", key, key.subarray(0, 16));
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(Buffer.from(encrypt, "base64")), decipher.final()]);
  const pad = padded[padded.length - 1];
  if (pad < 1 || pad > BLOCK) throw new Error("bad_padding");
  for (let index = 0; index < pad; index += 1) {
    if (padded[padded.length - 1 - index] !== pad) throw new Error("bad_padding");
  }
  const content = padded.subarray(0, padded.length - pad);
  if (content.length < 20) throw new Error("bad_padding");
  const length = content.readUInt32BE(16);
  const message = content.subarray(20, 20 + length);
  if (message.length !== length) throw new Error("bad_padding");
  return message.toString("utf8");
}

export function signaturesMatch(expected: string, actual: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
