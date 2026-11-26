import { describe, expect, it } from "vitest";
import { DSH_PIN, probeDsh, PROTOTYPE_PIN } from "../src/runtime/dshProbe.js";

describe("dsh probe", () => {
  it("stays unconfigured and pending when no binary is set", async () => {
    const result = await probeDsh({ nodeVersion: "v22.23.4" });
    expect(result.status).toBe("not_configured");
    expect(result.execution).toBe("unavailable");
    expect(result.prototypeLoaded).toBe(false);
    expect(result.pin).toEqual(DSH_PIN);
    expect(result.prototype.commit).toBe(PROTOTYPE_PIN.commit);
    expect(result.nodeRuntimeCompatible).toBe(false);
  });

  it("runs only --version and does not treat a match as integration", async () => {
    const calls: string[][] = [];
    const result = await probeDsh({
      bin: "/opt/dsh",
      nodeVersion: "v22.23.4",
      runner: async (cmd, args) => {
        calls.push([cmd, ...args]);
        return { code: 0, stdout: "dsh 0.2.3-alpha.2\n", stderr: "" };
      },
    });
    expect(calls).toEqual([["/opt/dsh", "--version"]]);
    expect(result.status).toBe("headless_cli_present");
    expect(result.execution).toBe("unavailable_node");
  });

  it("reports a mismatch without executing anything else", async () => {
    const result = await probeDsh({
      bin: "/opt/dsh",
      nodeVersion: "v24.22.3",
      runner: async () => ({ code: 0, stdout: "dsh 0.2.1-alpha.2\n", stderr: "" }),
    });
    expect(result.status).toBe("version_mismatch");
    expect(result.nodeRuntimeCompatible).toBe(true);
  });
});
