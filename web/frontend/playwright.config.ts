/**
 * Playwright E2E：默认连本地 Vite（MSW 打开时无需真实后端）。
 * CI 可设 CI=1 以禁止 only、启用重试；webServer 在本地可复用已启动的 dev。
 */
import { defineConfig, devices } from "@playwright/test"

const PORT = Number(process.env.E2E_PORT ?? "5173")
const HOST = process.env.E2E_HOST ?? "127.0.0.1"
const baseURL = `http://${HOST}:${PORT}`

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite --host ${HOST} --port ${String(PORT)} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      ...process.env,
      VITE_USE_MOCK: "true",
    },
  },
})
