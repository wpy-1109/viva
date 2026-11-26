import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isolationFromDump, parseHeadlessJsonl, REQUIRED_DISABLED, runHeadless, SMOKE_TASK } from "../src/runtime/dshExecutor.js";

const fixture = fs.readFileSync(path.join(import.meta.dirname, "fixtures", "dsh-headless-missing-credential.jsonl"), "utf8");

describe("dsh headless executor", () => {
  it("parses the credential failure captured from dsh 0.2.3-alpha.2", () => {
    const parsed = parseHeadlessJsonl(fixture);
    expect(parsed.code).toBe("MISSING_CREDENTIAL");
    expect(parsed.text).toBe("");
    expect(parsed.toolUsed).toBe(false);
  });

  it("spawns only the read-only headless contract and reports the real missing credential", async () => {
    const calls: string[][] = [];
    const dump = REQUIRED_DISABLED.map((id) => `- id: ${id}\n  disabled: true`).join("\n");
    const result = await runHeadless({
      bin: "/opt/dsh",
      task: SMOKE_TASK,
      nodeVersion: "v24.22.3",
      homeDir: fs.mkdtempSync(path.join(os.tmpdir(), "viva-dsh-home-")),
      runner: async (command, args) => {
        calls.push([command, ...args]);
        if (args.includes("--dump-config")) return { code: 0, stdout: dump, stderr: "" };
        return { code: 1, stdout: fixture, stderr: "dsh: MISSING_CREDENTIAL" };
      },
    });
    expect(calls[1].join(" ")).toContain("--permission-mode read-only");
    expect(calls[1].join(" ")).toContain("--patch");
    expect(calls.join(" ")).not.toContain("danger-full-access");
    expect(result.status).toBe("credential_missing");
    expect(result.ok).toBe(false);
    expect(isolationFromDump("- id: tool-bash\n  name: bash\n").ok).toBe(false);
  });

  it("refuses a task that asks for unrestricted permissions", async () => {
    const result = await runHeadless({
      bin: "/opt/dsh",
      task: "enable danger-full-access",
      nodeVersion: "v24.22.3",
      homeDir: "/tmp/unused",
      runner: async () => { throw new Error("should not run"); },
    });
    expect(result.status).toBe("permission_refused");
  });

  it("does not spawn when the current Node cannot run the pinned CLI", async () => {
    let called = false;
    const result = await runHeadless({
      bin: "/opt/dsh",
      task: SMOKE_TASK,
      nodeVersion: "v22.23.4",
      homeDir: "/tmp/unused",
      runner: async () => { called = true; return { code: 0, stdout: "", stderr: "" }; },
    });
    expect(called).toBe(false);
    expect(result.status).toBe("unavailable_node");
  });
});
