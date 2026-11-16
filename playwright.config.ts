import { defineConfig, devices } from "@playwright/test";
import { hashPassword } from "./shared/password.ts";
import { TEST_USERNAME, TEST_PASSWORD } from "./test/fixtures/credentials.ts";

const PORT = 8787;
// Fresh local D1/R2 state per run so login lockout counters never carry over.
const STATE_DIR = ".wrangler/e2e-state";

const testVars = {
  AUTH_USERNAME: TEST_USERNAME,
  AUTH_PASSWORD_HASH: await hashPassword(TEST_PASSWORD, 1_000),
  SESSION_SECRET: "e2e-session-secret", // pragma: allowlist secret -- fixed fake value for tests
};
const varFlags = Object.entries(testVars)
  .map(([key, value]) => `--var '${key}:${value}'`)
  .join(" ");

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // page.route cannot see requests a service worker makes, so most specs run without one;
    // pwa.spec.ts opts back in.
    serviceWorkers: "block",
  },
  projects: [
    {
      name: "mobile-chromium",
      // Uses the locally installed Chrome so no Playwright browser download is needed.
      use: { ...devices["Desktop Chrome"], channel: "chrome", viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: [
      `rm -rf ${STATE_DIR}`,
      "npm run build",
      `npx wrangler d1 migrations apply DB --local --persist-to ${STATE_DIR}`,
      `npx wrangler dev --port ${PORT} --persist-to ${STATE_DIR} ${varFlags}`,
    ].join(" && "),
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
