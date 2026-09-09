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
    env: {
      // Point the dev server's /api proxy at the Nginx front door.
      //
      // Its default is 127.0.0.1:8090, which is where a standalone `cargo run`
      // API binds. These suites drive the Docker stack, where the API is not
      // published on the host at all — it listens on 8080 inside its network
      // and Nginx on :80 is the only way in. With the default, every request
      // died as ECONNREFUSED, `GET /api/auth/demo-credentials` returned
      // nothing, the login page rendered no demo buttons, and all five accounts
      // failed with "no sign-in button" — a message about seeding, for a
      // problem that was a proxy target.
      //
      // Overridable, because the standalone deployment is still a supported way
      // to run this.
      VITE_API_PROXY_TARGET: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1',
    },
  },
});
