import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:43127" },
  webServer: {
    command: "rm -rf data/e2e && VIVA_HOST=127.0.0.1 VIVA_PORT=43127 VIVA_DATA_DIR=data/e2e node dist/server/main.js",
    url: "http://127.0.0.1:43127/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
  },
});