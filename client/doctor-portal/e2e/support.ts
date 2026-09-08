import { expect, type Page } from '@playwright/test';

/** Where the shared signed-in session is stored between projects. */
export const AUTH_STATE = 'e2e/.auth/doctor.json';

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

  // Matched by ROLE, not by name. The five hardcoded demo identities were
  // removed and the list now comes from the database — the fixtures are
  // currently "Dr Browser Test" and "Nurse Browser Test", and a selector
  // hardcoding a person's name breaks silently the next time a seed changes.
  const demoButton = page.locator('button').filter({ hasText: /doctor/i });
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
  // Client-side navigation only, never `page.goto` after sign-in.
  //
  // `authStore.restoreSession` fails closed **by design**: no access token,
  // refresh token or signing key is persisted, so nothing survives a full page
  // load and the app correctly returns to sign-in. See the long comment on
  // `restoreSession` — a durable session needs a persisted refresh token or a
  // cookie-borne one, and that trade-off has not been decided.
  //
  // A `goto` is a full load, so it logged the suite out on every route and
  // re-signing-in then goto-ing again just repeated the loop. Clicking the
  // in-app link keeps the React Router history and the in-memory session
  // intact, which is also what a real clinician does.
  if (!page.url().includes(path)) {
    const link = page.locator(`a[href="${path}"]`).first();
    if (await link.count()) {
      await link.click();
    } else {
      // Not in the navigation (a deep route). Push through the router rather
      // than reloading the document.
      await page.evaluate(p => {
        window.history.pushState({}, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
    }
  }

  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForTimeout(1200);
}
