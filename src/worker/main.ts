import { openDatabase } from "../db/database.js";
import { workerTick } from "./loop.js";

const db = openDatabase(process.env.VIVA_DATA_DIR ?? "data");
const owner = `worker-${process.pid}`;
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });

while (!stopped) {
  await workerTick(db, { owner, nowMs: Date.now(), fetchImpl: fetch, concurrency: Number(process.env.VIVA_WORKER_CONCURRENCY ?? 2) });
  await new Promise((resolve) => setTimeout(resolve, 1000));
}
db.close();
