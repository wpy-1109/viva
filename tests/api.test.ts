import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/server/app.js";

async function boot() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viva-api-"));
  const app = await createApp({ dataDir: dir });
  const token = fs.readFileSync(path.join(dir, "token"), "utf8").trim();
  const headers = { "x-viva-token": token, "x-viva-request": "1" };
  return { app, dir, token, headers };
}

describe("http api", () => {
  it("refuses session bootstrap from a public address unless the docker bridge exception is on", async () => {
    const { app } = await boot();
    const blocked = await app.inject({ method: "POST", url: "/api/session/bootstrap", remoteAddress: "8.8.8.8" });
    expect(blocked.statusCode).toBe(403);
    process.env.VIVA_DOCKER = "1";
    try {
      const bridge = await app.inject({ method: "POST", url: "/api/session/bootstrap", remoteAddress: "172.17.0.1" });
      expect(bridge.statusCode).toBe(200);
      const stillPublic = await app.inject({ method: "POST", url: "/api/session/bootstrap", remoteAddress: "8.8.8.8" });
      expect(stillPublic.statusCode).toBe(403);
    } finally {
      delete process.env.VIVA_DOCKER;
    }
    await app.close();
  });

  it("rejects a mutation without the local token and hides secrets", async () => {
    const { app, headers } = await boot();
    const denied = await app.inject({ method: "POST", url: "/api/autopilot/start" });
    expect(denied.statusCode).toBe(401);
    const saved = await app.inject({
      method: "PUT",
      url: "/api/settings/model",
      headers,
      payload: { mode: "live", baseUrl: "https://models.example/v1", model: "m", apiKey: "sk-api-secret" },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.body).not.toContain("sk-api-secret");
    const read = await app.inject({ method: "GET", url: "/api/settings/model", headers });
    expect(read.json().hasKey).toBe(true);
    expect(read.body).not.toContain("sk-api-secret");
    await app.close();
  });

  it("seeds labeled demo knowledge, answers with a citation, and keeps a stop", async () => {
    const { app, headers } = await boot();
    const seeded = await app.inject({ method: "POST", url: "/api/demo/seed", headers });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().label).toContain("演示数据");
    const synced = await app.inject({ method: "POST", url: `/api/sources/${seeded.json().sourceId}/sync`, headers });
    expect(synced.statusCode).toBe(200);
    const proposals = await app.inject({ method: "GET", url: "/api/proposals", headers });
    const first = proposals.json().proposals[0];
    const approved = await app.inject({ method: "POST", url: `/api/proposals/${first.id}/approve`, headers });
    expect(approved.statusCode).toBe(200);
    const asked = await app.inject({
      method: "POST",
      url: "/api/ask",
      headers,
      payload: { query: "演示数据说明检索不是向量" },
    });
    expect(asked.statusCode).toBe(200);
    expect(asked.json().retrieval).toMatch(/fts5-trigram|like-fallback/);
    expect(asked.json().citations.length).toBeGreaterThan(0);
    const stopped = await app.inject({ method: "POST", url: "/api/autopilot/stop", headers });
    expect(stopped.json().desired).toBe("stopped");
    const status = await app.inject({ method: "GET", url: "/api/autopilot", headers });
    expect(status.json().desired).toBe("stopped");
    await app.close();
  });

  it("accepts a signed Feishu event and refuses an unsigned one", async () => {
    const { app, headers } = await boot();
    const { feishuSignature } = await import("../src/channels/feishu.js");
    await app.inject({
      method: "PUT",
      url: "/api/settings/channels/feishu",
      headers,
      payload: { enabled: true, acceptInbound: true, allowOutbound: false, encryptKey: "encrypt-key" },
    });
    const body = JSON.stringify({
      header: { event_id: "evt-api", event_type: "im.message.receive_v1" },
      event: { message: { content: JSON.stringify({ text: "来自飞书的待审笔记" }) } },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const bad = await app.inject({ method: "POST", url: "/api/channels/feishu/webhook", payload: body, headers: { "content-type": "application/json" } });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({
      method: "POST",
      url: "/api/channels/feishu/webhook",
      payload: body,
      headers: {
        "content-type": "application/json",
        "x-lark-request-timestamp": timestamp,
        "x-lark-request-nonce": "n1",
        "x-lark-signature": feishuSignature(timestamp, "n1", "encrypt-key", body),
      },
    });
    expect(good.statusCode).toBe(200);
    const proposals = await app.inject({ method: "GET", url: "/api/proposals", headers });
    expect(proposals.json().proposals.some((item: { kind: string }) => item.kind === "channel")).toBe(true);
    await app.close();
  });
});
