import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("launchers", () => {
  it("checks the node launcher and keeps windows scripts as untested text", () => {
    const checked = spawnSync(process.execPath, ["--check", "scripts/viva.mjs"], { encoding: "utf8" });
    expect(checked.status).toBe(0);
    const cmd = fs.readFileSync("scripts/viva.cmd", "utf8");
    const ps1 = fs.readFileSync("scripts/viva.ps1", "utf8");
    expect(cmd).toContain("node");
    expect(cmd).toContain("viva.mjs");
    expect(ps1).toContain("Set-StrictMode");
    expect(ps1).toContain("viva.mjs");
    expect(cmd).toContain("Not executed on a Windows machine");
  });
});