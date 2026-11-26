import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

type SecretFile = Record<string, string>;

function secretsPath(dir: string) {
  return path.join(dir, "secrets.json");
}

function keyPath(dir: string) {
  return path.join(dir, "secret.key");
}

function loadKey(dir: string) {
  const target = keyPath(dir);
  if (!fs.existsSync(target)) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(target, randomBytes(32), { mode: 0o600 });
  }
  fs.chmodSync(target, 0o600);
  const key = fs.readFileSync(target);
  if (key.length !== 32) throw new Error("secret_key_invalid");
  return key;
}

function seal(key: Buffer, plain: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function openSeal(key: Buffer, value: string) {
  const [version, iv, tag, data] = value.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("secret_corrupt");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

export function readSecrets(dir: string): SecretFile {
  const target = secretsPath(dir);
  if (!fs.existsSync(target)) return {};
  const parsed = JSON.parse(fs.readFileSync(target, "utf8")) as SecretFile;
  const key = loadKey(dir);
  const out: SecretFile = {};
  let legacy = false;
  for (const [ref, value] of Object.entries(parsed)) {
    if (typeof value === "string" && value.startsWith("v1:")) out[ref] = openSeal(key, value);
    else {
      legacy = true;
      out[ref] = value;
    }
  }
  if (legacy) writeSecrets(dir, out);
  return out;
}

function writeSecrets(dir: string, secrets: SecretFile) {
  const key = loadKey(dir);
  const sealed: SecretFile = {};
  for (const [ref, value] of Object.entries(secrets)) sealed[ref] = seal(key, value);
  const target = secretsPath(dir);
  fs.writeFileSync(target, JSON.stringify(sealed), { mode: 0o600 });
  fs.chmodSync(target, 0o600);
}

export function writeSecret(dir: string, ref: string, value: string) {
  const current = readSecrets(dir);
  current[ref] = value;
  writeSecrets(dir, current);
}

export function readSecret(dir: string, ref: string | null | undefined) {
  if (!ref) return null;
  return readSecrets(dir)[ref] ?? null;
}
