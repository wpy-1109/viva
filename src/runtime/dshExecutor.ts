import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { nodeMatches } from "./dshProbe.js";

export const SMOKE_TASK = "Do not use tools. Do not read files. Reply with exactly: viva-dsh-smoke-ok";

export const PATCH_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../resources/dsh-text-only.patch.yml");

export const REQUIRED_DISABLED = ["tool-bash", "tool-fs", "tool-web", "tool-subagent", "tool-executor-native", "web-fetch-http"] as const;

export function isolationFromDump(dump: string) {
  const missing = REQUIRED_DISABLED.filter((id) => !new RegExp(`- id: ${id}\\n(?:(?!- id: )[\\s\\S])*disabled: true`).test(dump));
  return { ok: missing.length === 0, missing };
}

type Runner = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<{ code: number; stdout: string; stderr: string }>;

export function parseHeadlessJsonl(stdout: string) {
  const events = stdout.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
  const finalEvent = [...events].reverse().find((event) => event.type === "final");
  const reason = finalEvent?.reason as { kind?: string; error?: { code?: string; message?: string } } | undefined;
  const text = typeof finalEvent?.text === "string" ? finalEvent.text : "";
  const toolUsed = events.some((event) => event.type === "tool" || event.type === "tool_call" || event.phase === "tool");
  return {
    events,
    text,
    toolUsed,
    code: reason?.error?.code ?? null,
    ok: reason?.kind === "complete" || (reason == null && text.length > 0),
  };
}

export async function runHeadless(input: {
  bin: string;
  task: string;
  nodeVersion: string;
  homeDir: string;
  patchPath?: string;
  runner?: Runner;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}) {
  if (!nodeMatches(input.nodeVersion)) {
    return { ok: false, status: "unavailable_node" as const, text: "", toolUsed: false };
  }
  if (input.task.includes("danger-full-access")) {
    return { ok: false, status: "permission_refused" as const, text: "", toolUsed: false };
  }
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "viva-dsh-"));
  fs.mkdirSync(input.homeDir, { recursive: true });
  const patch = input.patchPath ?? PATCH_PATH;
  const runner = input.runner ?? defaultRunner;
  const childEnv: NodeJS.ProcessEnv = {
    PATH: input.env?.PATH ?? process.env.PATH,
    HOME: input.env?.HOME ?? process.env.HOME,
    DSH_HOME: input.homeDir,
  };
  if (input.env?.DEEPSEEK_API_KEY) childEnv.DEEPSEEK_API_KEY = input.env.DEEPSEEK_API_KEY;
  const dump = await runner(input.bin, ["--profile", "headless", "--patch", patch, "--dump-config"], { cwd: work, env: childEnv, timeoutMs: input.timeoutMs ?? 20_000 });
  const isolation = isolationFromDump(dump.stdout);
  if (dump.code !== 0 || !isolation.ok) {
    return { ok: false, status: "isolation_unavailable" as const, text: "", toolUsed: false, missing: isolation.missing };
  }
  const args = ["--profile", "headless", "--patch", patch, "--permission-mode", "read-only", "--approval-policy", "ask", "--json", input.task];
  if (args.includes("danger-full-access") || args.includes("workspace-write")) {
    return { ok: false, status: "permission_refused" as const, text: "", toolUsed: false };
  }
  const result = await runner(input.bin, args, { cwd: work, env: childEnv, timeoutMs: input.timeoutMs ?? 20_000 });
  const parsed = parseHeadlessJsonl(result.stdout);
  if (parsed.toolUsed) return { ok: false, status: "tool_use_refused" as const, text: "", toolUsed: true };
  if (parsed.code === "MISSING_CREDENTIAL") return { ok: false, status: "credential_missing" as const, text: "", toolUsed: false, stderr: result.stderr.slice(0, 500) };
  if (result.code !== 0 || !parsed.ok) return { ok: false, status: "run_failed" as const, text: parsed.text, toolUsed: false, stderr: result.stderr.slice(0, 500) };
  return { ok: true, status: "completed" as const, text: parsed.text, toolUsed: false };
}

function defaultRunner(command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, shell: false }, (error, stdout, stderr) => {
      const coded = error as NodeJS.ErrnoException & { code?: number | string } | null;
      if (coded && typeof coded.code === "number") {
        resolve({ code: coded.code, stdout: String(stdout), stderr: String(stderr) });
        return;
      }
      if (coded) {
        reject(coded);
        return;
      }
      resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}
