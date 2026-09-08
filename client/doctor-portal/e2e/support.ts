import { expect, type Page } from '@playwright/test';

/**
 * Shared harness for the doctor-portal browser suites.
 *
 * Sign-in goes through the demo-credential shortcut, which the login page
 * populates from `GET /api/auth/demo-credentials`. That endpoint answers only
 * when the API runs with **`MEDICHAIN_DEV_MODE`** *and* demo mode — anywhere
 * else it is a deliberate 403/404, so the demo buttons never render.
 *
 * When that happens the old `beforeEach` clicked a button that did not exist
 * and sat there for the full 30-second timeout, once per test, reporting only
 * "locator.click: Test timeout exceeded". The guard below turns a
 * ten-minute mystery into one line naming the missing environment variable.
 */
export async function signIn(page: Page) {
  await page.goto('/login');

  const demoButton = page.locator('button:has-text("Mbeki")');
  const available = await demoButton
    .first()
    .waitFor({ state: 'visible', timeout: 5000 })
    .then(() => true)
    .catch(() => false);

  expect(
    available,
    'No demo sign-in buttons on the login page.\n' +
      'They are populated from GET /api/auth/demo-credentials, which answers only when the\n' +
      'API runs with MEDICHAIN_DEV_MODE set AND demo mode enabled. The Docker compose file\n' +
      'does not set MEDICHAIN_DEV_MODE — that is deliberate, since the endpoint exposes\n' +
      'credentials and should not be on by default in a file anyone might deploy from.\n' +
      'To run these suites, start the API with MEDICHAIN_DEV_MODE=1.'
  ).toBe(true);

  await demoButton.click();
  await expect(page).toHaveURL(/.*dashboard/);
}

/**
 * Navigate and wait for real content.
 *
 * NOT `waitForLoadState('networkidle')`: this app holds an SSE stream open on
 * /api/events, so the network is never idle and that wait can only time out.
 */
export async function settle(page: Page, path: string) {
  await page.goto(path);
  // `main`, not `h1`: the first `h1` belongs to the mobile header, which is
  // `lg:hidden` at desktop width, so waiting on it waits forever for something
  // deliberately invisible.
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
}
