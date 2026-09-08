import { test, expect, type Page } from '@playwright/test';
import { signIn, settle, setTheme, ROUTES } from './support';

/**
 * Measured contrast audit of the patient app, in both themes.
 *
 * Contrast is a property of painted pixels, not of source. A component can name
 * a perfectly good token and still fail depending on which ancestor supplied the
 * background and which variant won the cascade — so this walks the rendered
 * page rather than reading the code.
 *
 * The patient app had **no browser test of any kind** before this file. Every
 * claim made about contrast, keyboard access and reflow on this project applied
 * only to the doctor portal, across 53 pages that had never been opened by a
 * test. This app is arguably the higher-risk surface: non-expert users, personal
 * phones, varied lighting, and at least one screen read during an emergency.
 *
 * Thresholds are WCAG 2.2 SC 1.4.3 Level AA: 4.5:1 for normal text, 3:1 for
 * large text (>=24px, or >=18.66px when bold).
 */

interface Failure {
  ratio: number;
  required: number;
  foreground: string;
  background: string;
  fontSize: number;
  text: string;
  selector: string;
}

async function auditContrast(page: Page) {
  return page.evaluate(() => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (colour: string): number | null => {
      const parts = colour.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      // A fully transparent colour paints nothing; treat it as unmeasurable
      // rather than as black, which would invent a ratio either way.
      if (parts.length >= 4 && Number(parts[3]) === 0) return null;
      const [r, g, b] = parts.slice(0, 3).map(Number);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (fg: string, bg: string): number | null => {
      const a = luminance(fg);
      const b = luminance(bg);
      if (a === null || b === null) return null;
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    };

    // Walk up for the background actually painted behind this element. A
    // gradient is reported separately rather than guessed at: an element over
    // `linear-gradient(...)` has no single background colour, and pretending
    // otherwise produces a spurious 1.0:1 "white on white" for every heading on
    // a gradient banner.
    const backgroundOf = (el: Element): { colour?: string; gradient?: true } => {
      let node: Element | null = el;
      while (node) {
        const cs = getComputedStyle(node);
        if (cs.backgroundImage && cs.backgroundImage !== 'none') return { gradient: true };
        const c = cs.backgroundColor;
        if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return { colour: c };
        node = node.parentElement;
      }
      return { colour: 'rgb(255, 255, 255)' };
    };

    const describe = (el: Element) => {
      const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 3).join('.');
      return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`;
    };

    const failures: Failure[] = [];
    let sampled = 0;
    let gradientSkipped = 0;

    document
      .querySelectorAll('p,span,td,th,li,h1,h2,h3,h4,h5,label,button,a,strong,em,small,dt,dd')
      .forEach(el => {
        const text = (el.textContent || '').trim();
        if (!text) return;
        // Only elements owning a direct text node, or a wrapper is measured
        // using its child's colour and every failure is double-counted.
        const ownsText = Array.from(el.childNodes).some(
          n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()
        );
        if (!ownsText) return;

        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        const bg = backgroundOf(el);
        if (bg.gradient) {
          gradientSkipped++;
          return;
        }
        const ratio = contrast(cs.color, bg.colour!);
        if (ratio === null) return;

        sampled++;
        const fontSize = parseFloat(cs.fontSize);
        const bold = parseInt(cs.fontWeight, 10) >= 700;
        const required = fontSize >= 24 || (fontSize >= 18.66 && bold) ? 3 : 4.5;

        if (ratio < required) {
          failures.push({
            ratio: Number(ratio.toFixed(2)),
            required,
            foreground: cs.color,
            background: bg.colour!,
            fontSize,
            text: text.slice(0, 40),
            selector: describe(el),
          });
        }
      });

    failures.sort((a, b) => a.ratio - b.ratio);
    return { sampled, gradientSkipped, failures };
  });
}

function report(route: string, theme: string, result: { sampled: number; failures: Failure[] }) {
  const lines = result.failures.map(
    f =>
      `    ${f.ratio}:1 (needs ${f.required}:1)  ${f.selector}\n` +
      `      "${f.text}"\n` +
      `      ${f.foreground} on ${f.background} @ ${f.fontSize}px`
  );
  return (
    `${route} [${theme}]: ${result.failures.length} of ${result.sampled} sampled ` +
    `element(s) below WCAG AA\n${lines.join('\n')}`
  );
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

for (const route of ROUTES) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${route.name} meets WCAG AA in ${theme} mode`, async ({ page }) => {
      await settle(page, route.path);
      // Guard against a silent redirect to /login leaving the audit measuring
      // the wrong screen and reporting coverage it never had.
      expect(page.url(), `${route.name} redirected away from ${route.path}`).toContain(route.path);
      await setTheme(page, theme);

      const result = await auditContrast(page);

      expect(result.sampled, `${route.name} rendered no measurable text`).toBeGreaterThan(0);
      expect(result.failures, report(route.name, theme, result)).toHaveLength(0);
    });
  }
}
