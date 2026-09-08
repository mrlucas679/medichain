import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // Serial, deliberately. Each test signs in, and every sign-in is several
  // requests against an API that rate-limits at 60/minute. Parallel workers
  // turned a healthy run into a wall of RATE_LIMIT_EXCEEDED that surfaced as
  // navigation timeouts — which read as application faults and are not.
  //
  // The proper fix is reusing one signed-in session via storageState. That was
  // tried and does not work here yet: the keys save correctly, but the app
  // revalidates on load and routes back to /login. Worth revisiting; until
  // then, correctness beats speed.
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
