import { execFile } from "node:child_process";

export const DSH_PIN = {
  npm: "@deepseek-ai/dsh@0.2.3-alpha.2",
  gitTag: "dsh-v0.2.3-alpha.2",
  commit: "4b399c39a6d1479cd84ca591b4d7c88e24d38a96",
  enginesNode: "^24.22.3 || >=26.13.1",
};

export const PROTOTYPE_PIN = {
  repo: "deepseek-ai/dsh-superagent-prototype",
  commit: "8c32a9dc5d72c033816c6a8110b37f40cf94fba4",
  peerDsh: "^0.2.1-alpha.2",
  execution: "not_loaded" as const,
  reason: "npm 默认 semver 不把 0.2.3-alpha.2 算进 ^0.2.1-alpha.2；打开 includePrerelease 才算满足。该原型的执行器预设包含 shell，并以操作系统用户身份运行。Viva 不安装、不加载这个 bundle。",
};

type Runner = (command: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export async function probeDsh(input: { bin?: string; runner?: Runner; nodeVersion: string }) {
  const base = {
    pin: DSH_PIN,
    prototype: PROTOTYPE_PIN,
    nodeVersion: input.nodeVersion,
    nodeRuntimeCompatible: nodeMatches(input.nodeVersion),
    execution: nodeMatches(input.nodeVersion) ? "read_only_headless" as const : "unavailable_node" as const,
    prototypeLoaded: false,
    contract: {
      command: "dsh --profile headless --permission-mode read-only --approval-policy ask --json <task>",
      refused: ["danger-full-access", "workspace-write"],
      isolation: "子进程的 cwd 是空临时目录，DSH_HOME 在 Viva 数据目录。这不是操作系统沙箱；官方 headless 仍带有 bash 工具，read-only 预设不能保证模型无法触达进程权限。",
    },
  };
  if (!input.bin) return { ...base, status: "not_configured" as const, execution: "unavailable" as const };
  const runner = input.runner ?? defaultRunner;
  try {
    const result = await runner(input.bin, ["--version"]);
    if (result.code !== 0) return { ...base, status: "probe_error" as const, stderr: result.stderr.slice(0, 200) };
    const observed = result.stdout.trim();
    if (!observed.includes("0.2.3-alpha.2")) return { ...base, status: "version_mismatch" as const, observed, execution: "unavailable" as const };
    if (!nodeMatches(input.nodeVersion)) return { ...base, status: "headless_cli_present" as const, observed, execution: "unavailable_node" as const };
    return { ...base, status: "headless_ready" as const, observed };
  } catch (error) {
    return { ...base, status: "probe_error" as const, stderr: error instanceof Error ? error.message : "probe_error" };
  }
}

function defaultRunner(command: string, args: string[]) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    execFile(command, args, { timeout: 3000, shell: false }, (error, stdout, stderr) => {
      if (error && typeof (error as NodeJS.ErrnoException).code === "string" && (error as NodeJS.ErrnoException).code !== "0") {
        const coded = error as NodeJS.ErrnoException & { code?: number | string };
        if (typeof coded.code === "number") {
          resolve({ code: coded.code, stdout: String(stdout), stderr: String(stderr) });
          return;
        }
        reject(error);
        return;
      }
      resolve({ code: 0, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

export function nodeMatches(version: string) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) return false;
  const [major, minor, patch] = match.slice(1).map(Number);
  if (major > 26 || (major === 26 && (minor > 13 || (minor === 13 && patch >= 1)))) return true;
  if (major === 24) {
    if (minor > 22) return true;
    if (minor === 22 && patch >= 3) return true;
  }
  return false;
}
