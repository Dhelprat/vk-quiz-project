import { defineConfig } from '@playwright/test'

const externalBaseURL = process.env.E2E_BASE_URL

export default defineConfig({
  testDir: './e2e',
  timeout: 45_000,
  expect: {
    timeout: 8_000,
  },
  fullyParallel: false,
  reporter: [['line']],
  use: {
    baseURL: externalBaseURL || 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: externalBaseURL ? undefined : [
    {
      command: 'PORT=8010 npm run start',
      cwd: '../backend',
      url: 'http://127.0.0.1:8010/api/health',
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'VITE_BACKEND_TARGET=http://127.0.0.1:8010 npm run dev -- --host 127.0.0.1',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: true,
      timeout: 30_000,
    },
  ],
})
