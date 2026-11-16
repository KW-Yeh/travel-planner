import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { hashPassword } from "./shared/password.ts";
import { TEST_PASSWORD, TEST_USERNAME } from "./test/fixtures/credentials.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["shared/**/*.test.ts", "src/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                AUTH_USERNAME: TEST_USERNAME,
                AUTH_PASSWORD_HASH: await hashPassword(TEST_PASSWORD, 1_000),
                SESSION_SECRET: "test-session-secret", // pragma: allowlist secret -- fixed fake value for tests
                GOOGLE_ROUTES_KEY: "",
                GOOGLE_MAPS_BROWSER_KEY: "",
                GOOGLE_MAP_ID: "",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/worker/**/*.test.ts"],
          setupFiles: ["./test/worker/apply-migrations.ts"],
        },
      },
    ],
  },
});
