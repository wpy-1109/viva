import fs from "node:fs";
import path from "node:path";

const ALLOWED = new Set([".md", ".markdown", ".txt", ".mdx"]);
export const MAX_FILE_BYTES = 512 * 1024;

export type LocalFile = { path: string; text: string };
export type Skipped = { path: string; reason: string };

export function collectLocal(root: string) {
  const realRoot = fs.realpathSync(root);
  const files: LocalFile[] = [];
  const skipped: Skipped[] = [];

  function visit(dir: string) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (rel === "" || rel.split("/").includes("..")) continue;
      if (entry.isSymbolicLink()) {
        if (!inside(realRoot, full)) skipped.push({ path: rel, reason: "symlink_escape" });
        else if (entry.isFile()) readFile(full, rel, files, skipped);
        continue;
      }
      if (entry.isDirectory()) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        visit(full);
        continue;
      }
      if (!entry.isFile()) continue;
      readFile(full, rel, files, skipped);
    }
  }

  visit(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, skipped };
}

function readFile(full: string, rel: string, files: LocalFile[], skipped: Skipped[]) {
  const extension = path.extname(rel).toLowerCase();
  if (!ALLOWED.has(extension)) return;
  const realRoot = fs.realpathSync(path.dirname(full));
  const realFile = fs.realpathSync(full);
  const root = fs.realpathSync(findRoot(full, rel));
  if (!inside(root, realFile) || path.relative(root, realRoot).startsWith("..")) {
    skipped.push({ path: rel, reason: "symlink_escape" });
    return;
  }
  const size = fs.statSync(realFile).size;
  if (size > MAX_FILE_BYTES) {
    skipped.push({ path: rel, reason: "file_too_large" });
    return;
  }
  files.push({ path: rel, text: fs.readFileSync(realFile, "utf8") });
}

function findRoot(full: string, rel: string) {
  const depth = rel.split("/").length;
  let cursor = path.dirname(full);
  for (let index = 1; index < depth; index += 1) cursor = path.dirname(cursor);
  return cursor;
}

function inside(root: string, candidate: string) {
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return false;
  }
  const relative = path.relative(root, real);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
