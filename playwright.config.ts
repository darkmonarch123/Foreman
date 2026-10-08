import { defineConfig, devices } from "@playwright/test";

/**
 * Two suites:
 *
 *   board   The real board UI and sync engine in Chromium, against an
 *           in-memory test backend (tests/browser). Needs nothing external.
 *
 *   e2e     The full user journey against a real Supabase project
 *           (tests/e2e). Skipped unless the E2E_* variables are set; see
 *           docs/testing.md.
 */
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;

export default defineConfig({
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    launchOptions: executablePath ? { executablePath } : {},
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "board",
      testDir: "./tests/browser",
      use: { baseURL: "http://127.0.0.1:4317" },
    },
    {
      name: "e2e",
      testDir: "./tests/e2e",
      use: { baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000" },
    },
  ],
  webServer: {
    command: "npx vite --config tests/browser/vite.config.mts",
    url: "http://127.0.0.1:4317",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
