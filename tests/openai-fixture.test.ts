import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ask } from "../src/knowledge/answer.js";
import { publishProposal } from "../src/knowledge/publish.js";
import { saveModel } from "../src/control/state.js";
import { createSource } from "../src/sources/registry.js";
import { syncSource } from "../src/sources/sync.js";
import { tempWorkspace } from "./helpers.js";

function published(db: ReturnType<typeof tempWorkspace>["db"]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-fix-"));
  fs.writeFileSync(path.join(root, "note.md"), "夹具模型必须保留这条引用。\n");
  const source = createSource(db, { kind: "local", name: "夹具", root, nowMs: 1 });
  syncSource(db, source.id, { nowMs: 2 });
  publishProposal(db, (db.prepare("SELECT id FROM proposals").get() as { id: string }).id, 3);
}

function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  return new Promise<{ server: http.Server; url: string }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("no port");
      resolve({ server, url: `http://127.0.0.1:${address.port}/v1` });
    });
  });
}

describe("openai compatible fixture transport", () => {
  it("keeps citations across a real local HTTP call and surfaces upstream failures", async () => {
    const { db } = tempWorkspace();
    published(db);
    const seen: Array<{ stream?: boolean; auth?: string }> = [];
    const fixture = await listen((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk) => chunks.push(chunk));
      request.on("end", () => {
        const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { stream?: boolean; model?: string };
        seen.push({ stream: body.stream, auth: request.headers.authorization });
        if (request.headers.authorization !== "Bearer fixture-key") {
          response.writeHead(401).end("denied");
          return;
        }
        if (body.model === "malformed") {
          response.writeHead(200, { "content-type": "application/json" }).end("{");
          return;
        }
        if (body.model === "sse") {
          response.writeHead(200, { "content-type": "text/event-stream" }).end("data: hi\n\n");
          return;
        }
        response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
          choices: [{ message: { content: "夹具回答保留引用 [1]" } }],
          usage: { prompt_tokens: 4, completion_tokens: 3 },
        }));
      });
    });
    saveModel(db, { mode: "live", baseUrl: fixture.url, model: "fixture-model", apiKey: "fixture-key", nowMs: 1 });
    const ok = await ask(db, { query: "引用", nowMs: 10, fetchImpl: fetch });
    expect(ok.answer).toContain("夹具回答");
    expect(ok.citations[0].path).toBe("note.md");
    expect(ok.citations[0].revisionId).toBeTruthy();
    expect(seen[0].stream).toBeUndefined();
    expect(ok.providerMode).toBe("live");
    saveModel(db, { mode: "live", baseUrl: fixture.url, model: "fixture-model", apiKey: "wrong", nowMs: 2 });
    const denied = await ask(db, { query: "引用", nowMs: 11, fetchImpl: fetch });
    expect(denied.error).toContain("401");
    expect(denied.answer ?? "").not.toContain("演示提供者");
    saveModel(db, { mode: "live", baseUrl: fixture.url, model: "malformed", apiKey: "fixture-key", nowMs: 3 });
    const broken = await ask(db, { query: "引用", nowMs: 12, fetchImpl: fetch });
    expect(broken.error).toBe("network_error");
    saveModel(db, { mode: "live", baseUrl: fixture.url, model: "sse", apiKey: "fixture-key", nowMs: 4 });
    const stream = await ask(db, { query: "引用", nowMs: 13, fetchImpl: fetch });
    expect(stream.error).toBe("unsupported_stream");
    const hanging = await listen(() => {});
    saveModel(db, { mode: "live", baseUrl: hanging.url, model: "slow", apiKey: "fixture-key", nowMs: 5 });
    const timed = await ask(db, { query: "引用", nowMs: 14, timeoutMs: 30, fetchImpl: fetch });
    expect(timed.error).toBe("timeout");
    fixture.server.close();
    hanging.server.close();
  });
});
