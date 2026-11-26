import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openDatabase } from "../src/db/database.js";

export function tempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "viva-"));
  const db = openDatabase(dir);
  return { dir, db };
}
