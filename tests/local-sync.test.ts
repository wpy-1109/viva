import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSource } from "../src/sources/registry.js";
import { syncSource } from "../src/sources/sync.js";
import { publishProposal, rejectProposal, rollbackPublished } from "../src/knowledge/publish.js";
import { searchPublished } from "../src/knowledge/retrieve.js";
import { setPolicy } from "../src/control/state.js";
import { tempWorkspace } from "./helpers.js";

function corpus(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "viva-corpus-"));
  for (const [name, text] of Object.entries(files)) {
    const full = path.join(root, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
  return root;
}

describe("local sources and proposals", () => {
  it("ingests markdown, proposes a change, publishes, and rolls back", () => {
    const { db } = tempWorkspace();
    const root = corpus({ "guide.md": "# 指南\n\n第一版说明本地优先。\n" });
    const source = createSource(db, { kind: "local", name: "手册", root, nowMs: 1_000 });
    const first = syncSource(db, source.id, { nowMs: 2_000 });
    expect(first.documents).toBe(1);
    expect(first.proposals).toBe(1);
    const proposal = db.prepare("SELECT id, kind, status, diff_text FROM proposals").get() as {
      id: string;
      kind: string;
      status: string;
      diff_text: string;
    };
    expect(proposal.kind).toBe("change");
    expect(proposal.diff_text).toContain("+");
    publishProposal(db, proposal.id, 3_000);
    const found = searchPublished(db, "本地优先");
    expect(found.retrieval).toBe("fts5-trigram");
    expect(found.hits[0].path).toBe("guide.md");
    fs.writeFileSync(path.join(root, "guide.md"), "# 指南\n\n第二版补充了检查点。\n");
    const second = syncSource(db, source.id, { nowMs: 4_000 });
    expect(second.proposals).toBe(1);
    const stale = db.prepare("SELECT id, kind FROM proposals WHERE status = 'pending_review'").get() as { id: string; kind: string };
    expect(stale.kind).toBe("stale");
    publishProposal(db, stale.id, 5_000);
    expect(searchPublished(db, "检查点").hits).toHaveLength(1);
    const rolled = rollbackPublished(db, "guide.md", source.id, 6_000);
    expect(rolled.checksum).not.toBe(searchPublished(db, "检查点").hits[0]?.checksum);
    expect(searchPublished(db, "本地优先").hits[0].text).toContain("第一版");
  });

  it("does not autopublish unless the policy is explicitly enabled", () => {
    const { db } = tempWorkspace();
    const root = corpus({ "a.md": "仅供审阅的句子，不会自动发布。\n" });
    const source = createSource(db, { kind: "local", name: "审阅", root, nowMs: 1 });
    syncSource(db, source.id, { nowMs: 2 });
    const row = db.prepare("SELECT status FROM proposals").get() as { status: string };
    expect(row.status).toBe("pending_review");
    expect(db.prepare("SELECT COUNT(*) AS n FROM published_chunks").get()).toEqual({ n: 0 });
  });

  it("autopublishes only a short change when the policy says so", () => {
    const { db } = tempWorkspace();
    setPolicy(db, { autopublishEnabled: true, autopublishMaxLines: 40, nowMs: 1 });
    const root = corpus({ "short.md": "短变更可以在显式策略下发布。\n" });
    const source = createSource(db, { kind: "local", name: "短", root, nowMs: 1 });
    syncSource(db, source.id, { nowMs: 2 });
    const row = db.prepare("SELECT status, kind FROM proposals").get() as { status: string; kind: string };
    expect(row).toMatchObject({ kind: "change", status: "approved" });
  });

  it("rejects a proposal without publishing it", () => {
    const { db } = tempWorkspace();
    const root = corpus({ "nope.md": "这条知识不该进入已发布版本。\n" });
    const source = createSource(db, { kind: "local", name: "拒绝", root, nowMs: 1 });
    syncSource(db, source.id, { nowMs: 2 });
    const id = (db.prepare("SELECT id FROM proposals").get() as { id: string }).id;
    expect(rejectProposal(db, id, 3, "不准确").status).toBe("rejected");
    expect(searchPublished(db, "不该进入").hits).toHaveLength(0);
  });

  it("rejects a relative local root", () => {
    const { db } = tempWorkspace();
    expect(() => createSource(db, { kind: "local", name: "相对", root: "docs", nowMs: 1 })).toThrow(/root_not_absolute/);
  });

  it("skips escaped paths, symlinks, and oversized files", () => {
    const { db } = tempWorkspace();
    const root = corpus({ "ok.md": "根目录内的正常笔记。\n" });
    fs.writeFileSync(path.join(root, "..", "outside.md"), "外面的秘密不该被读入。\n");
    fs.symlinkSync(path.join(root, "..", "outside.md"), path.join(root, "linked.md"));
    fs.writeFileSync(path.join(root, "big.md"), "大".repeat(600 * 1024));
    const source = createSource(db, { kind: "local", name: "边界", root, nowMs: 1 });
    const result = syncSource(db, source.id, { nowMs: 2 });
    expect(result.documents).toBe(1);
    const paths = db.prepare("SELECT path FROM documents").all() as { path: string }[];
    expect(paths.map((row) => row.path)).toEqual(["ok.md"]);
    expect(result.skipped.map((item) => item.reason).sort()).toEqual(["file_too_large", "symlink_escape"]);
  });

  it("removes a published path when the file disappears", () => {
    const { db } = tempWorkspace();
    const root = corpus({ "gone.md": "这份笔记稍后会被删除。\n" });
    const source = createSource(db, { kind: "local", name: "删除", root, nowMs: 1 });
    syncSource(db, source.id, { nowMs: 2 });
    publishProposal(db, (db.prepare("SELECT id FROM proposals").get() as { id: string }).id, 3);
    fs.rmSync(path.join(root, "gone.md"));
    syncSource(db, source.id, { nowMs: 4 });
    const removal = db.prepare("SELECT id, kind FROM proposals WHERE kind = 'removal'").get() as { id: string; kind: string };
    expect(removal.kind).toBe("removal");
    publishProposal(db, removal.id, 5);
    expect(searchPublished(db, "稍后会被删除").hits).toHaveLength(0);
  });

  it("flags a title conflict across sources", () => {
    const { db } = tempWorkspace();
    const left = corpus({ "topic.md": "# 同一标题\n\n来自甲的正文。\n" });
    const right = corpus({ "topic.md": "# 同一标题\n\n来自乙的不同正文。\n" });
    const a = createSource(db, { kind: "local", name: "甲", root: left, nowMs: 1 });
    const b = createSource(db, { kind: "local", name: "乙", root: right, nowMs: 1 });
    syncSource(db, a.id, { nowMs: 2 });
    publishProposal(db, (db.prepare("SELECT id FROM proposals").get() as { id: string }).id, 3);
    syncSource(db, b.id, { nowMs: 4 });
    const conflict = db.prepare("SELECT kind FROM proposals WHERE source_id = ? AND kind = 'conflict'").get(b.id) as { kind: string };
    expect(conflict.kind).toBe("conflict");
  });
});
