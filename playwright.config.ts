import { defineConfig, devices } from '@playwright/test';

// Allow an isolated loopback binding when another application owns IPv4 :4173.
const viteHost = process.env.PLAYWRIGHT_VITE_HOST ?? '127.0.0.1';
const viteUrl = `http://${viteHost.includes(':') ? `[${viteHost}]` : viteHost}:4173`;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: viteUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chromium',
      testIgnore: '**/shared-api.spec.ts',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      testIgnore: '**/shared-api.spec.ts',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'shared-api-chromium',
      testMatch: '**/shared-api.spec.ts',
      fullyParallel: false,
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `npm run dev -- --host ${viteHost} --port 4173 --strictPort`,
      url: viteUrl,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'dotnet run --project api/TodoBoard.Api --no-launch-profile --urls http://localhost:5080',
      url: 'http://localhost:5080/api/health',
      env: {
        Storage__Mode: 'InMemory',
        ASPNETCORE_ENVIRONMENT: 'Development',
      },
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
