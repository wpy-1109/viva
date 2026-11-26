import { describe, expect, it, vi } from "vitest";
import { fetchGithubSnapshot, openPullRequest } from "../src/sources/github.js";

const sha = "a".repeat(40);
const next = "b".repeat(40);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("github source", () => {
  it("reads a repository through the documented REST endpoints", async () => {
    const calls: string[] = [];
    const snapshot = await fetchGithubSnapshot(
      { owner: "acme", repo: "docs", ref: "main" },
      {
        token: "ghp_test",
        fetchImpl: async (url, init) => {
          calls.push(String(url));
          expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ghp_test");
          const href = String(url);
          if (href.endsWith("/commits/main")) return json({ sha });
          if (href.includes("/git/trees/")) {
            return json({ tree: [{ path: "guide.md", type: "blob", size: 12 }, { path: "img.png", type: "blob", size: 4 }] });
          }
          if (href.includes("/contents/guide.md")) {
            return json({ content: Buffer.from("# 指南\n正文\n").toString("base64"), encoding: "base64", size: 12 });
          }
          return json({ message: "unexpected" }, 404);
        },
      },
    );
    expect(snapshot.cursor).toBe(sha);
    expect(snapshot.files.map((file) => file.path)).toEqual(["guide.md"]);
    expect(calls.some((url) => url.includes("/git/trees/"))).toBe(true);
    expect(calls.some((url) => url.includes("POST"))).toBe(false);
  });

  it("uses compare to catch up from a checkpoint", async () => {
    const calls: string[] = [];
    const snapshot = await fetchGithubSnapshot(
      { owner: "acme", repo: "docs", ref: "main", cursor: sha },
      {
        fetchImpl: async (url) => {
          calls.push(String(url));
          const href = String(url);
          if (href.endsWith("/commits/main")) return json({ sha: next });
          if (href.includes(`/compare/${sha}...${next}`)) {
            return json({ files: [{ filename: "guide.md", status: "modified" }, { filename: "old.md", status: "removed" }] });
          }
          if (href.includes("/contents/guide.md")) return json({ content: Buffer.from("新正文\n").toString("base64"), encoding: "base64", size: 10 });
          return json({}, 404);
        },
      },
    );
    expect(snapshot.cursor).toBe(next);
    expect(snapshot.files.map((file) => file.path)).toEqual(["guide.md"]);
    expect(snapshot.removed).toEqual(["old.md"]);
    expect(calls.some((url) => url.includes("/compare/"))).toBe(true);
  });

  it("does not open a pull request unless the switch and confirmation are both present", async () => {
    const fetchImpl = vi.fn(async () => json({ html_url: "https://github.com/acme/docs/pull/1" }));
    const blocked = await openPullRequest({
      owner: "acme",
      repo: "docs",
      title: "更新",
      body: "说明",
      head: "viva",
      base: "main",
      token: "ghp_test",
      enabled: false,
      confirm: "open-pull-request",
      fetchImpl,
    });
    expect(blocked.opened).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    const opened = await openPullRequest({
      owner: "acme",
      repo: "docs",
      title: "更新",
      body: "说明",
      head: "viva",
      base: "main",
      token: "ghp_test",
      enabled: true,
      confirm: "open-pull-request",
      fetchImpl,
    });
    expect(opened.opened).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://api.github.com/repos/acme/docs/pulls");
  });
});
