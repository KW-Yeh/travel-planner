import { defineConfig, devices } from "@playwright/test";

const PORT = 8787;

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-chromium",
      // Uses the locally installed Chrome so no Playwright browser download is needed.
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: `npm run build && npx wrangler d1 migrations apply DB --local && npx wrangler dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
