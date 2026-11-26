const SECRET_KEY = /api[-_]?key|token|secret|authorization|password|encrypt|credential/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value)) {
      out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(inner);
    }
    return out;
  }
  if (typeof value === "string") {
    return value
      .replace(/sk-[A-Za-z0-9_-]{6,}/g, "sk-[redacted]")
      .replace(/Bearer\s+[A-Za-z0-9._~+/-]{8,}/gi, "Bearer [redacted]");
  }
  return value;
}
