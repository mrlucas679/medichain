import { expect, type Page } from '@playwright/test';

/**
 * Shared harness for the patient-app browser suites.
 *
 * Kept in one file so the contrast and accessibility specs cannot drift on how
 * they sign in or how long they wait — the doctor portal grew two slightly
 * different `settle` helpers before they were unified.
 */

/**
 * Sign in through the demo-wallet path.
 *
 * The five hardcoded demo identities were removed; "Create Demo Wallet" is the
 * remaining deterministic route, and it goes through the real credential path
 * behind a demo-gated resolver, so this exercises the same login the product
 * uses rather than a test-only shortcut.
 */
export async function signIn(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: /create demo wallet/i }).click();
  await page.getByPlaceholder(/enter your name/i).fill('E2E Patient');
  await page.getByRole('button', { name: /create & login/i }).click();
  await expect(page).toHaveURL(/\/(dashboard)?$/, { timeout: 20000 });
}

/**
 * Navigate and wait for real content.
 *
 * NOT `waitForLoadState('networkidle')`: this app holds an SSE stream open on
 * /api/events, so the network never goes idle and that wait can only time out.
 */
export async function settle(page: Page, path: string) {
  await page.goto(path);
  await page.locator('main').first().waitFor({ state: 'visible', timeout: 15000 });
  // Let late-arriving data paint. A list that fills in after the audit runs is
  // a list the audit never checked.
  await page.waitForTimeout(1200);
}

export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate(t => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // The class flips CSS custom properties; give style recalculation a moment.
  // Sampling too early reports the previous theme and manufactures failures
  // that do not exist — which happened on the doctor portal and cost a round
  // of chasing eleven imaginary defects.
  await page.waitForTimeout(400);
}

/** Routes worth guarding, clinical-risk first. */
export const ROUTES = [
  // The emergency card is the single highest-consequence screen in this
  // product: it is read by a stranger, in a hurry, on someone else's phone,
  // about a patient who may be unconscious.
  { path: '/emergency-card', name: 'Emergency card' },
  { path: '/medical-id', name: 'Medical ID' },
  { path: '/medications', name: 'Medications' },
  { path: '/lab-results', name: 'Lab results' },
  { path: '/vitals', name: 'Vitals' },
  { path: '/dashboard', name: 'Dashboard' },
  { path: '/records', name: 'My records' },
  { path: '/consent', name: 'Consent' },
  { path: '/appointments', name: 'Appointments' },
  { path: '/settings', name: 'Settings' },
];
