import { createApp } from "./app.js";

const host = process.env.VIVA_HOST ?? "127.0.0.1";
const port = Number(process.env.VIVA_PORT ?? 43123);
if (host !== "127.0.0.1" && host !== "::1" && process.env.VIVA_ALLOW_NONLOCAL !== "1") {
  console.error("拒绝监听非回环地址。若确有需要，设置 VIVA_ALLOW_NONLOCAL=1。");
  process.exit(1);
}
const app = await createApp({ dataDir: process.env.VIVA_DATA_DIR ?? "data" });
await app.listen({ host, port });
console.log(`Viva 正在 http://${host}:${port}`);
