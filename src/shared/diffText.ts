import { createPatch } from "diff";

export function unifiedDiff(filePath: string, before: string, after: string) {
  return createPatch(filePath, before, after, "已发布", "候选");
}

export function diffLineCount(diff: string) {
  return diff.split("\n").filter((line) => (
    (line.startsWith("+") || line.startsWith("-"))
    && !line.startsWith("+++")
    && !line.startsWith("---")
  )).length;
}
