import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ask } from "../src/knowledge/answer.js";
import { publishProposal } from "../src/knowledge/publish.js";
import { createSource } from "../src/sources/registry.js";
import { syncSource } from "../src/sources/sync.js";
import { saveModel } from "../src/control/state.js";
import { tempWorkspace } from "./helpers.js";

function published(db: ReturnType<typeof tempWorkspace>["db"], text: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-ans-"));
  fs.writeFileSync(path.join(root, "note.md"), text);
  const source = createSource(db, { kind: "local", name: "笔记", root, nowMs: 1 });
  syncSource(db, source.id, { nowMs: 2 });
  const id = (db.prepare("SELECT id FROM proposals").get() as { id: string }).id;
  publishProposal(db, id, 3);
}

describe("answers", () => {
  it("abstains without calling a model when nothing matches", async () => {
    const { db } = tempWorkspace();
    published(db, "只有园艺日历，没有飞行手册。\n");
    let calls = 0;
    const result = await ask(db, {
      query: "量子纠缠如何校准",
      nowMs: 10,
      fetchImpl: async () => {
        calls += 1;
        throw new Error("should not be called");
      },
    });
    expect(result.abstained).toBe(true);
    expect(result.answer).toBeNull();
    expect(result.retrieval).toBe("fts5-trigram");
    expect(calls).toBe(0);
  });

  it("labels a deterministic demo answer and cites the stored revision", async () => {
    const { db } = tempWorkspace();
    published(db, "澄知用检查点记住上次同步位置。\n");
    const result = await ask(db, { query: "检查点", nowMs: 10, fetchImpl: fetch });
    expect(result.providerMode).toBe("demo");
    expect(result.abstained).toBe(false);
    expect(result.answer?.startsWith("【演示提供者·非实时模型】")).toBe(true);
    expect(result.citations[0].revisionId).toBeTruthy();
    expect(result.citations[0].path).toBe("note.md");
    expect(result.retrieval).toBe("fts5-trigram");
  });

  it("returns the live error without a demo fallback", async () => {
    const { db } = tempWorkspace();
    published(db, "真实模型应该看到这段关于备份的说明。\n");
    saveModel(db, { mode: "live", baseUrl: "https://models.example/v1", model: "demo-model", apiKey: "sk-test-secret", nowMs: 1 });
    const result = await ask(db, {
      query: "备份",
      nowMs: 10,
      fetchImpl: async () => new Response("nope", { status: 401 }),
    });
    expect(result.error).toContain("401");
    expect(result.answer ?? "").not.toContain("演示提供者");
    expect(result.providerMode).toBe("live");
  });

  it("times out a live call without switching to the demo provider", async () => {
    const { db } = tempWorkspace();
    published(db, "超时测试使用的备份说明。\n");
    saveModel(db, { mode: "live", baseUrl: "https://models.example/v1", model: "unit-model", apiKey: "sk-test-secret", nowMs: 1 });
    const result = await ask(db, {
      query: "备份",
      nowMs: 10,
      timeoutMs: 20,
      fetchImpl: () => new Promise(() => {}),
    });
    expect(result.error).toBe("timeout");
    expect(result.answer ?? "").not.toContain("演示提供者");
  });

  it("stops when the call budget is already exhausted", async () => {
    const { db } = tempWorkspace();
    published(db, "预算耗尽时不应该再请求模型。\n");
    saveModel(db, { mode: "live", baseUrl: "https://models.example/v1", model: "demo-model", apiKey: "sk-test-secret", nowMs: 1 });
    db.prepare("UPDATE policies SET max_calls_per_run = 0 WHERE workspace_id = 'local'").run();
    let calls = 0;
    const result = await ask(db, {
      query: "预算",
      nowMs: 10,
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(result.error).toBe("bound_exceeded");
    expect(calls).toBe(0);
  });

  it("sends an OpenAI-compatible chat request for a grounded live answer", async () => {
    const { db } = tempWorkspace();
    published(db, "备份文件默认不包含密钥。\n");
    saveModel(db, { mode: "live", baseUrl: "https://models.example/v1", model: "unit-model", apiKey: "sk-test-secret", nowMs: 1 });
    const seen: { url?: string; auth?: string; body?: any } = {};
    const result = await ask(db, {
      query: "备份",
      nowMs: 10,
      fetchImpl: async (url, init) => {
        seen.url = String(url);
        seen.auth = (init?.headers as Record<string, string>).authorization;
        seen.body = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: "备份不含密钥。[1]" } }], usage: { prompt_tokens: 20, completion_tokens: 8 } }), { status: 200 });
      },
    });
    expect(seen.url).toBe("https://models.example/v1/chat/completions");
    expect(seen.auth).toBe("Bearer sk-test-secret");
    expect(seen.body.model).toBe("unit-model");
    expect(seen.body.messages[0].content).toContain("不可信");
    expect(result.answer).toBe("备份不含密钥。[1]");
    expect(result.citations).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});
