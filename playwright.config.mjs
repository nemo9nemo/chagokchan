import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./scripts/ui", workers: 1, retries: 0, forbidOnly: true, timeout: 60000,
  reporter: [["list"], ["json", { outputFile: "tmp/ui-regression-results.json" }]],
  use: { baseURL: "http://127.0.0.1:3417", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { browserName: "chromium", ...(process.platform === "win32" ? { channel: "msedge" } : {}), viewport: { width: 1280, height: 900 } } },
    { name: "mobile", use: { browserName: "chromium", ...(process.platform === "win32" ? { channel: "msedge" } : {}), viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true } },
  ],
  webServer: { command: "node scripts/ui-test-server.mjs", url: "http://127.0.0.1:3417", reuseExistingServer: false, timeout: 120000 },
});
