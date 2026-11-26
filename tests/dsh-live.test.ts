import { describe, expect, it } from "vitest";
import { runHeadless, SMOKE_TASK } from "../src/runtime/dshExecutor.js";

const live = process.env.VIVA_DSH_LIVE === "1" && Boolean(process.env.VIVA_DSH_BIN);

describe("dsh live headless", () => {
  it.skipIf(!live)("runs the pinned CLI in read-only mode and records the real outcome", async () => {
    const result = await runHeadless({
      bin: process.env.VIVA_DSH_BIN!,
      task: SMOKE_TASK,
      nodeVersion: process.version,
      homeDir: "/tmp/viva-dsh-live-home",
      timeoutMs: 30_000,
    });
    expect(["credential_missing", "completed", "run_failed"]).toContain(result.status);
    expect(result.status).not.toBe("completed");
    expect(result.toolUsed).toBe(false);
  });
});
