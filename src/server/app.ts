import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { acceptChannelText } from "../channels/inbound.js";
import { verifyDingTalk } from "../channels/dingtalk.js";
import { verifyFeishu } from "../channels/feishu.js";
import { buildDingTalkMarkdown, buildFeishuText, sendIfAllowed } from "../channels/outbound.js";
import { beat, getDesiredState, publicModel, saveModel, setDesiredState, setPolicy } from "../control/state.js";
import { openDatabase, type VivaDb } from "../db/database.js";
import { ask, testModel } from "../knowledge/answer.js";
import { applicability, listProposals, publishProposal, rejectProposal, rollbackPublished } from "../knowledge/publish.js";
import { searchPublished } from "../knowledge/retrieve.js";
import { cancel, counts, enqueue, listEvents, listJobs } from "../jobs/queue.js";
import { activatePrompt, evaluatePrompt, proposePrompt, rollbackPrompt } from "../policy/prompts.js";
import { probeDsh } from "../runtime/dshProbe.js";
import { readSecret, writeSecret } from "../secrets/store.js";
import { createBackup } from "../backup/backup.js";
import type { FetchImpl } from "../sources/github.js";
import { openPullRequest } from "../sources/github.js";
import { createSource, listSources, softDeleteSource } from "../sources/registry.js";
import { syncAny, syncSource } from "../sources/sync.js";
import { runHeadless, SMOKE_TASK } from "../runtime/dshExecutor.js";
import { VivaError } from "../shared/errors.js";

type RequestWithRaw = FastifyRequest & { rawBody?: string };

export async function createApp(options: { dataDir: string; fetchImpl?: FetchImpl; now?: () => number }) {
  const db = openDatabase(options.dataDir);
  const token = ensureToken(options.dataDir);
  const now = () => options.now?.() ?? Date.now();
  const fetchImpl = options.fetchImpl ?? fetch;
  const app = Fastify({ logger: false, bodyLimit: 256 * 1024 });
  await app.register(cookie);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (request as RequestWithRaw).rawBody = raw;
    try {
      done(null, raw ? JSON.parse(raw) : {});
    } catch (error) {
      done(error as Error, undefined);
    }
  });

  app.addHook("onRequest", async (request, reply) => {
    const url = request.url.split("?")[0];
    if (!url.startsWith("/api/")) return;
    if (url === "/api/health" || url.startsWith("/api/channels/") || url.startsWith("/api/hooks/") || (url === "/api/session/bootstrap" && request.method === "POST")) return;
    const presented = String(request.headers["x-viva-token"] ?? request.cookies.viva_token ?? "");
    if (!tokenEquals(token, presented)) return reply.code(401).send({ error: "unauthorized" });
    if (request.method !== "GET" && request.method !== "HEAD" && request.headers["x-viva-request"] !== "1") {
      return reply.code(403).send({ error: "missing_request_header" });
    }
    const origin = request.headers.origin;
    if (typeof origin === "string" && !isLocalOrigin(origin)) return reply.code(403).send({ error: "bad_origin" });
  });

  app.get("/api/health", async () => ({ ok: true, name: "viva", version: "0.2.1", desired: getDesiredState(db), retrieval: "fts5-trigram" }));
  app.get("/api/doctor", async () => doctor(db, options.dataDir));
  app.post("/api/recovery/release-stale", async () => {
    const released = db.prepare("UPDATE jobs SET status = 'pending', lease_owner = NULL, lease_until = NULL, updated_at = ? WHERE workspace_id = 'local' AND status = 'leased'").run(new Date(now()).toISOString());
    return { released: released.changes, desired: getDesiredState(db) };
  });
  app.post("/api/runtime/dsh/smoke", async () => {
    const bin = process.env.VIVA_DSH_BIN;
    if (!bin) return { ok: false, status: "not_configured" };
    return runHeadless({
      bin,
      task: SMOKE_TASK,
      nodeVersion: process.version,
      homeDir: path.join(options.dataDir, "dsh-home"),
      env: process.env.VIVA_DSH_FORWARD_KEY === "1" ? process.env : {},
    });
  });

  app.post("/api/session/bootstrap", async (request, reply) => {
    const address = request.socket.remoteAddress ?? "";
    if (!bootstrapAllowed(address)) return reply.code(403).send({ error: "loopback_only" });
    reply.setCookie("viva_token", token, { httpOnly: true, sameSite: "strict", path: "/" });
    return { ok: true };
  });

  app.get("/api/overview", async () => overview(db));
  app.get("/api/sources", async () => ({ sources: listSources(db).map(publicSource) }));
  app.post("/api/sources", async (request, reply) => {
    const body = request.body as { kind: "local" | "github" | "url"; name: string; root?: string; owner?: string; repo?: string; ref?: string; url?: string; token?: string; intervalSeconds?: number };
    try {
      const source = createSource(db, { ...body, nowMs: now() });
      return publicSource(source);
    } catch (error) {
      return reply.code(400).send({ error: messageOf(error) });
    }
  });
  app.post("/api/sources/:id/sync", async (request, reply) => {
    const params = request.params as { id: string };
    try {
      return await syncAny(db, params.id, { nowMs: now(), fetchImpl });
    } catch (error) {
      return reply.code(400).send({ error: messageOf(error) });
    }
  });
  app.post("/api/sources/:id/delete", async (request) => {
    const params = request.params as { id: string };
    softDeleteSource(db, params.id, now());
    return { ok: true };
  });
  app.get("/api/knowledge", async () => ({
    documents: db.prepare("SELECT path, title, checksum, revision_id, document_key, substr(text, 1, 240) AS preview FROM published_chunks WHERE workspace_id = 'local' ORDER BY path").all(),
  }));
  app.get("/api/search", async (request) => searchPublished(db, String((request.query as { q?: string }).q ?? "")));
  app.get("/api/proposals", async () => ({
    proposals: listProposals(db).map((row) => ({ ...row, ...applicability(db, row) })),
  }));
  app.post("/api/proposals/:id/approve", async (request, reply) => act(reply, () => publishProposal(db, (request.params as { id: string }).id, now())));
  app.post("/api/proposals/:id/reject", async (request, reply) => act(reply, () => rejectProposal(db, (request.params as { id: string }).id, now(), String((request.body as { note?: string })?.note ?? ""))));
  app.post("/api/proposals/:id/rollback", async (request, reply) => {
    const proposal = listProposals(db).find((item) => item.id === (request.params as { id: string }).id);
    if (!proposal?.document_path || !proposal.source_id) return reply.code(400).send({ error: "nothing_to_rollback" });
    return act(reply, () => rollbackPublished(db, proposal.document_path!, proposal.source_id!, now()));
  });
  app.post("/api/proposals/:id/export", async (request, reply) => {
    const proposal = listProposals(db).find((item) => item.id === (request.params as { id: string }).id);
    if (!proposal) return reply.code(404).send({ error: "proposal_not_found" });
    const dir = path.join(options.dataDir, "exports");
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `${proposal.id}.json`);
    const payload = { title: proposal.title, body: proposal.evidence_json, patch: proposal.diff_text };
    fs.writeFileSync(target, JSON.stringify(payload, null, 2));
    const body = request.body as { confirm?: string; owner?: string; repo?: string; head?: string; base?: string };
    const policy = db.prepare("SELECT github_publish_enabled FROM policies WHERE workspace_id = 'local'").get() as { github_publish_enabled: number };
    const remote = await openPullRequest({
      owner: body.owner ?? "",
      repo: body.repo ?? "",
      title: proposal.title,
      body: "Viva 提案导出。请人工审阅。",
      head: body.head ?? "viva",
      base: body.base ?? "main",
      token: readSecret(db.dataDir, "github:publish"),
      enabled: policy.github_publish_enabled === 1,
      confirm: body.confirm,
      fetchImpl,
    });
    return { file: target, remote };
  });
  app.get("/api/jobs", async () => ({ counts: counts(db), jobs: listJobs(db).map((job) => ({ ...job, events: listEvents(db, job.id) })) }));
  app.post("/api/jobs/:id/cancel", async (request) => cancel(db, (request.params as { id: string }).id, now()));
  app.get("/api/autopilot", async () => ({
    desired: getDesiredState(db),
    counts: counts(db),
    heartbeat: db.prepare("SELECT * FROM heartbeats WHERE workspace_id = 'local' AND role = 'worker'").get() ?? null,
    boundary: "只有本机进程在运行且期望状态为 running 时才会调度。睡眠、关机或进程退出期间不会检查；再次启动后按检查点追赶。",
  }));
  app.post("/api/autopilot/start", async () => ({ desired: setDesiredState(db, "running", now()) }));
  app.post("/api/autopilot/stop", async () => ({ desired: setDesiredState(db, "stopped", now()) }));
  app.post("/api/ask", async (request) => ask(db, { query: String((request.body as { query?: string }).query ?? ""), nowMs: now(), fetchImpl }));
  app.post("/api/feedback", async (request) => {
    const body = request.body as { questionId?: string; rating?: string; comment?: string };
    const id = randomBytes(16).toString("hex");
    const unanswered = body.rating === "down" || !body.questionId ? 1 : 0;
    db.prepare("INSERT INTO feedback (id, workspace_id, question_id, rating, comment, unanswered, created_at) VALUES (?, 'local', ?, ?, ?, ?, ?)").run(
      id,
      body.questionId ?? null,
      body.rating ?? null,
      body.comment ?? "",
      unanswered,
      new Date(now()).toISOString(),
    );
    if (body.rating === "down" || body.comment) {
      const question = body.questionId
        ? db.prepare("SELECT citations_json FROM questions WHERE id = ?").get(body.questionId) as { citations_json: string } | undefined
        : db.prepare("SELECT citations_json FROM questions WHERE workspace_id = 'local' ORDER BY created_at DESC LIMIT 1").get() as { citations_json: string } | undefined;
      const citations = question ? JSON.parse(question.citations_json) as Array<{ path?: string; revisionId?: string }> : [];
      const cited = citations[0];
      const source = cited?.revisionId
        ? db.prepare("SELECT source_id FROM documents WHERE revision_id = ? AND path = ?").get(cited.revisionId, cited.path) as { source_id: string } | undefined
        : undefined;
      const { createProposal } = await import("../knowledge/publish.js");
      createProposal(db, {
        sourceId: source?.source_id ?? null,
        kind: "feedback",
        title: "来自使用反馈的修订候选",
        documentPath: cited?.path ?? null,
        documentKey: null,
        baseText: "",
        candidateText: body.comment || "用户认为回答没有帮助。",
        evidence: {
        untrusted: true,
        feedbackId: id,
        rating: body.rating ?? null,
        questionId: body.questionId ?? null,
        sourcePath: cited?.path ?? null,
        revisionId: cited?.revisionId ?? null,
        actionable: "请对照引用的修订，决定是否把这条反馈写进知识。",
      },
        idempotencyKey: `feedback:${id}`,
      }, now());
    }
    return { id };
  });
  app.get("/api/settings/model", async () => publicModel(db));
  app.put("/api/settings/model", async (request) => {
    const body = request.body as { mode: "demo" | "live"; baseUrl?: string; model?: string; apiKey?: string };
    return saveModel(db, { ...body, nowMs: now() });
  });
  app.post("/api/settings/model/test", async () => testModel(db, fetchImpl));
  app.get("/api/settings/channels", async () => ({ channels: channelView(db) }));
  app.put("/api/settings/channels/:kind", async (request) => {
    const kind = (request.params as { kind: string }).kind;
    const body = request.body as { enabled?: boolean; acceptInbound?: boolean; allowOutbound?: boolean; encryptKey?: string; secret?: string; webhookUrl?: string };
    if (kind !== "feishu" && kind !== "dingtalk") return { error: "unknown_channel" };
    const ref = `channel:${kind}`;
    if (body.encryptKey || body.secret) writeSecret(db.dataDir, ref, body.encryptKey || body.secret || "");
    const current = db.prepare("SELECT settings_json, secret_ref FROM channel_config WHERE workspace_id = 'local' AND kind = ?").get(kind) as { settings_json: string; secret_ref: string | null };
    const settings = { ...JSON.parse(current.settings_json || "{}"), webhookUrl: body.webhookUrl };
    db.prepare(`UPDATE channel_config SET enabled = ?, accept_inbound = ?, allow_outbound = ?, settings_json = ?, secret_ref = ? WHERE workspace_id = 'local' AND kind = ?`).run(
      Number(body.enabled ?? false),
      Number(body.acceptInbound ?? false),
      Number(body.allowOutbound ?? false),
      JSON.stringify(settings),
      body.encryptKey || body.secret ? ref : current.secret_ref,
      kind,
    );
    return channelView(db).find((item) => item.kind === kind);
  });
  app.post("/api/hooks/sources/:id", async (request, reply) => {
    const params = request.params as { id: string };
    const source = db.prepare("SELECT id, secret_ref FROM sources WHERE id = ? AND workspace_id = 'local' AND deleted_at IS NULL").get(params.id) as { id: string; secret_ref: string | null } | undefined;
    const secret = readSecret(db.dataDir, source?.secret_ref?.endsWith(":hook") ? source.secret_ref : `source:${params.id}:hook`);
    const raw = (request as RequestWithRaw).rawBody ?? "";
    const provided = String(request.headers["x-viva-hook-signature"] ?? "");
    const expected = secret ? createHmac("sha256", secret).update(raw).digest("hex") : "";
    if (!source || !secret || !tokenEquals(expected, provided)) return reply.code(401).send({ error: "bad_signature" });
    const eventId = String((request.body as { eventId?: string })?.eventId ?? expected.slice(0, 12));
    enqueue(db, { type: "source.sync", idempotencyKey: `sync:${source.id}:hook:${eventId}`, payload: { sourceId: source.id }, nowMs: now() });
    return reply.code(202).send({ queued: true });
  });
  app.post("/api/channels/feishu/webhook", async (request, reply) => channelReply(db, reply, "feishu", (request as RequestWithRaw).rawBody ?? "", request.headers, now()));
  app.post("/api/channels/dingtalk/webhook", async (request, reply) => channelReply(db, reply, "dingtalk", (request as RequestWithRaw).rawBody ?? "", request.headers, now()));
  app.get("/api/runtime/dsh", async () => probeDsh({ bin: process.env.VIVA_DSH_BIN, nodeVersion: process.version }));
  app.post("/api/backup", async () => ({ directory: createBackup(db, options.dataDir, now()) }));
  app.get("/api/policy", async () => db.prepare("SELECT autopublish_enabled, autopublish_max_lines, github_publish_enabled, active_prompt_id, max_calls_per_run, max_tokens_per_call, max_estimated_usd FROM policies WHERE workspace_id = 'local'").get());
  app.put("/api/policy", async (request) => setPolicy(db, { ...(request.body as { autopublishEnabled?: boolean; autopublishMaxLines?: number; githubPublishEnabled?: boolean }), nowMs: now() }));
  app.get("/api/prompts", async () => ({ prompts: db.prepare("SELECT id, name, status, body, eval_json, created_at FROM prompt_versions WHERE workspace_id = 'local' ORDER BY created_at").all() }));
  app.post("/api/prompts", async (request) => {
    const body = request.body as { name: string; body: string };
    return proposePrompt(db, { name: body.name, body: body.body, nowMs: now() });
  });
  app.post("/api/prompts/:id/evaluate", async (request) => evaluatePrompt(db, (request.params as { id: string }).id, now()));
  app.post("/api/prompts/:id/activate", async (request, reply) => act(reply, () => activatePrompt(db, (request.params as { id: string }).id, now())));
  app.post("/api/prompts/rollback", async () => rollbackPrompt(db, now()));
  app.post("/api/demo/seed", async () => seedDemo(db, options.dataDir, now()));
  app.post("/api/channels/:kind/test-outbound", async (request) => {
    const kind = (request.params as { kind: string }).kind;
    const row = db.prepare("SELECT allow_outbound, settings_json FROM channel_config WHERE workspace_id = 'local' AND kind = ?").get(kind) as { allow_outbound: number; settings_json: string } | undefined;
    const settings = JSON.parse(row?.settings_json || "{}") as { webhookUrl?: string };
    const payload = kind === "dingtalk" ? buildDingTalkMarkdown("Viva", "这是一条尚未默认发送的测试。") : buildFeishuText("这是一条尚未默认发送的测试。");
    return sendIfAllowed({ allow: row?.allow_outbound === 1, url: settings.webhookUrl, payload, fetchImpl });
  });

  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../web/dist");
  if (fs.existsSync(path.join(webDist, "index.html"))) {
    await app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/")) return reply.code(404).send({ error: "not_found" });
      return reply.sendFile("index.html");
    });
  }

  app.addHook("onClose", async () => {
    beat(db, "server", "closed", now());
    db.close();
  });
  return app;
}

function channelReply(db: VivaDb, reply: FastifyReply, kind: string, rawBody: string, headers: FastifyRequest["headers"], nowMs: number) {
  const row = db.prepare("SELECT enabled, accept_inbound, secret_ref FROM channel_config WHERE workspace_id = 'local' AND kind = ?").get(kind) as { enabled: number; accept_inbound: number; secret_ref: string | null } | undefined;
  const secret = readSecret(db.dataDir, row?.secret_ref) ?? "";
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) flat[key] = Array.isArray(value) ? value[0] : value;
  const result = kind === "feishu"
    ? verifyFeishu(db, rawBody, flat, { encryptKey: secret }, nowMs)
    : verifyDingTalk(db, rawBody, flat, secret, nowMs);
  if (!result.ok) {
    const code = result.reason === "dingtalk_encrypted_callback_unsupported" ? 501 : 401;
    return reply.code(code).send(result);
  }
  if ("challenge" in result && result.challenge) return { challenge: result.challenge };
  if (row?.enabled && row.accept_inbound && result.eventId) acceptChannelText(db, kind, result.eventId, result.text, nowMs);
  return { ok: true, duplicate: false };
}

function seedDemo(db: VivaDb, dataDir: string, nowMs: number) {
  const root = path.resolve(dataDir, "demo-corpus");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "readme.md"), `# 演示数据·澄知

这是演示数据说明检索不是向量，而是本地 FTS5 trigram 词法检索。
检查点记住上次成功同步的位置。变更要等人看过差异后才发布。
自动驾驶停掉之后，进程重启也不会自己开始认领任务。
`);
  const existing = listSources(db).find((source) => source.name === "演示数据·澄知手册");
  const source = existing ?? createSource(db, { kind: "local", name: "演示数据·澄知手册", root, nowMs });
  const synced = syncSource(db, source.id, { nowMs });
  return { label: "演示数据·澄知手册", sourceId: source.id, demo: true, proposals: synced.proposals, documents: synced.documents };
}

function overview(db: VivaDb) {
  const sources = (db.prepare("SELECT COUNT(*) AS n FROM sources WHERE workspace_id = 'local' AND deleted_at IS NULL").get() as { n: number }).n;
  const knowledge = (db.prepare("SELECT COUNT(*) AS n FROM published_chunks WHERE workspace_id = 'local'").get() as { n: number }).n;
  const proposals = (db.prepare("SELECT COUNT(*) AS n FROM proposals WHERE workspace_id = 'local' AND status = 'pending_review'").get() as { n: number }).n;
  return { desired: getDesiredState(db), sources, knowledge, proposals, jobs: counts(db), retrieval: "fts5-trigram" };
}

function publicSource(source: { id: string; kind: string; name: string; config_json: string; interval_seconds: number; enabled: number; secret_ref: string | null }) {
  const config = JSON.parse(source.config_json) as Record<string, unknown>;
  return { id: source.id, kind: source.kind, name: source.name, config, intervalSeconds: source.interval_seconds, enabled: Boolean(source.enabled), hasSecret: Boolean(source.secret_ref) };
}

function channelView(db: VivaDb) {
  return (db.prepare("SELECT kind, enabled, accept_inbound, allow_outbound, settings_json, secret_ref FROM channel_config WHERE workspace_id = 'local'").all() as { kind: string; enabled: number; accept_inbound: number; allow_outbound: number; settings_json: string; secret_ref: string | null }[]).map((row) => {
    const settings = JSON.parse(row.settings_json || "{}") as { webhookUrl?: string };
    return {
      kind: row.kind,
      enabled: Boolean(row.enabled),
      acceptInbound: Boolean(row.accept_inbound),
      allowOutbound: Boolean(row.allow_outbound),
      hasSecret: Boolean(row.secret_ref && readSecret(db.dataDir, row.secret_ref)),
      hasWebhook: Boolean(settings.webhookUrl),
    };
  });
}

function ensureToken(dir: string) {
  const target = path.join(dir, "token");
  if (!fs.existsSync(target)) fs.writeFileSync(target, randomBytes(32).toString("hex"), { mode: 0o600 });
  return fs.readFileSync(target, "utf8").trim();
}

function tokenEquals(expected: string, presented: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(presented);
  return left.length === right.length && timingSafeEqual(left, right);
}

function doctor(db: VivaDb, dataDir: string) {
  const model = publicModel(db);
  let writable = true;
  try {
    fs.accessSync(dataDir, fs.constants.W_OK);
  } catch {
    writable = false;
  }
  const heartbeat = db.prepare("SELECT status, last_seen FROM heartbeats WHERE workspace_id = 'local' AND role = 'worker'").get() as { status: string; last_seen: string } | undefined;
  const missing: string[] = [];
  if (model.mode === "live" && !model.hasKey) missing.push("真实模型还没有 API key，测试连接也不会假装成功。");
  if (!process.env.VIVA_DSH_BIN) missing.push("没有配置 DSH 可执行文件。独立知识环仍然可用。");
  if (!heartbeat) missing.push("还没有看到 worker 心跳。定时检查需要另开 worker，或用 npm run viva 一起启动。");
  return {
    writable,
    desired: getDesiredState(db),
    worker: heartbeat ?? null,
    model: { mode: model.mode, hasKey: model.hasKey, baseUrlSet: Boolean(model.baseUrl), modelSet: Boolean(model.model) },
    retrieval: "fts5-trigram",
    dsh: { configured: Boolean(process.env.VIVA_DSH_BIN), node: process.version },
    missing,
    recovery: "若任务卡在进行中，可以释放过期租约。停止之后不会自动改为运行。",
  };
}

function isLocalOrigin(origin: string) {
  try {
    const url = new URL(origin);
    return url.hostname === "127.0.0.1" || url.hostname === "localhost";
  } catch {
    return false;
  }
}

function isLoopback(address: string) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

function bootstrapAllowed(address: string) {
  if (isLoopback(address)) return true;
  if (process.env.VIVA_DOCKER !== "1") return false;
  return isPrivate(address);
}

function isPrivate(address: string) {
  const value = address.replace(/^::ffff:/, "");
  if (value.startsWith("10.") || value.startsWith("192.168.")) return true;
  const second = Number(value.split(".")[1]);
  return value.startsWith("172.") && second >= 16 && second <= 31;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "error";
}

function act(reply: FastifyReply, fn: () => unknown) {
  try {
    return fn();
  } catch (error) {
    const code = error instanceof VivaError ? 409 : 400;
    return reply.code(code).send({ error: messageOf(error) });
  }
}
