import { type Page } from '@playwright/test';

/**
 * The measurements, separated from the specs that assert on them.
 *
 * `contrast.spec.ts` grew a 100-line in-page auditor and `accessibility.spec.ts`
 * grew another for target size. Auditing five accounts instead of one meant
 * either copying both a third time or moving them here. Copying a measurement
 * is how two files start disagreeing about what passes.
 */

export interface ContrastFailure {
  ratio: number;
  required: number;
  foreground: string;
  background: string;
  fontSize: number;
  text: string;
  selector: string;
}

export interface ContrastResult {
  sampled: number;
  gradientSkipped: number;
  failures: ContrastFailure[];
}

/**
 * Measure every rendered text node against WCAG 2.2 SC 1.4.3.
 *
 * Runs inside the page and is therefore one self-contained function: it is
 * serialised across the CDP boundary and can close over nothing out here.
 *
 * Contrast is a property of painted pixels, not of source code. A component can
 * name a perfectly good token and still fail, because the colour it ends up
 * with depends on which ancestor supplied the background, which theme is
 * active, and which variant won the cascade. None of that exists until the page
 * is rendered in a browser.
 */
export async function auditContrast(page: Page): Promise<ContrastResult> {
  return page.evaluate(() => {
    const channel = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const luminance = (colour: string): number | null => {
      const parts = colour.match(/[\d.]+/g);
      if (!parts || parts.length < 3) return null;
      // A fully transparent colour paints nothing; treat it as unmeasurable
      // rather than as black, which would invent a passing or failing ratio.
      if (parts.length >= 4 && Number(parts[3]) === 0) return null;
      const [r, g, b] = parts.slice(0, 3).map(Number);
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const contrast = (fg: string, bg: string): number | null => {
      const a = luminance(fg);
      const b = luminance(bg);
      if (a === null || b === null) return null;
      const hi = Math.max(a, b);
      const lo = Math.min(a, b);
      return (hi + 0.05) / (lo + 0.05);
    };

    /**
     * The background an element is actually painted on: walk up until something
     * paints. A gradient is reported separately rather than guessed at — an
     * element over `linear-gradient(...)` has no single background colour, and
     * pretending otherwise produced a spurious 1.0:1 "white on white" reading
     * for every heading on the gradient banner.
     */
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

    const failures: ContrastFailure[] = [];
    let sampled = 0;
    let gradientSkipped = 0;

    document
      .querySelectorAll('p,span,td,th,li,h1,h2,h3,h4,h5,label,button,a,strong,em,small')
      .forEach((el) => {
        const text = (el.textContent || '').trim();
        if (!text) return;
        // Only elements that own a direct text node — otherwise a wrapper is
        // measured using its child's colour and every failure is double-counted.
        const ownsText = Array.from(el.childNodes).some(
          (n) => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim()
        );
        if (!ownsText) return;

        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
        const rect = (el as HTMLElement).getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;

        // Visually-hidden text has no contrast to fail. `sr-only` clips its
        // element to about 1px and positions it off-screen, so it is never
        // painted — but it is not `display: none`, and its 1x1 box passes the
        // zero-size check above. Measuring it reported a screen-reader label on
        // the barcode screen as 1.21:1, which is a reading of two colours that
        // never appear together on screen.
        //
        // Note the asymmetry with the target-size audit: there, an sr-only skip
        // link IS a real target once focused, and is measured separately. Here
        // there is nothing to measure at all.
        const visuallyHidden =
          cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
          cs.clipPath === 'inset(50%)' ||
          (rect.width <= 2 && rect.height <= 2);
        if (visuallyHidden || (el.getAttribute('class') || '').split(/\s+/).includes('sr-only')) return;

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

export interface UndersizedTarget {
  selector: string;
  w: number;
  h: number;
  text: string;
}

/** WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA — 24 x 24 CSS px. */
export async function auditTargetSize(page: Page): Promise<UndersizedTarget[]> {
  return page.evaluate(() => {
    const MIN = 24;
    const results: UndersizedTarget[] = [];
    document
      .querySelectorAll<HTMLElement>('button, a[href], input, select, [role="button"]')
      .forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) === 0) return;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return;
        // A visually-hidden control is clipped to about 1px until it is focused.
        // The skip link is the canonical case: measured while hidden it reports
        // 16x8 and looks like a violation, when in reality it is not a target at
        // all until a keyboard user reaches it.
        const clipped =
          cs.clip === 'rect(0px, 0px, 0px, 0px)' ||
          cs.clipPath === 'inset(50%)' ||
          (r.width <= 2 && r.height <= 2);
        if (clipped || el.className.includes('sr-only')) return;
        // SC 2.5.8 exempts targets in a sentence ("inline"), and those whose
        // spacing gives them a 24px exclusion zone. Approximate the inline
        // exception by skipping anchors laid out inline inside text.
        if (el.tagName === 'A' && cs.display === 'inline') return;

        // A checkbox or radio inside a <label> is not the target — the label is.
        // Clicking anywhere in it toggles the control, so the label's box is
        // what a user has to hit, and that is what SC 2.5.8 measures.
        //
        // This matters: a native unstyled checkbox is 13x13 in every browser,
        // and 137 of them were reported across four screens. Growing each to
        // 24px would be a large visual change made to satisfy a measurement
        // that was asking the wrong element. Where the label is *also* under
        // 24px the pair is still reported, which is the real failure.
        let box = r;
        if (el.tagName === 'INPUT') {
          const type = (el as HTMLInputElement).type;
          if (type === 'checkbox' || type === 'radio') {
            // Either association counts. A wrapping <label> and a sibling
            // `<label for="...">` both toggle the control when clicked, so both
            // are part of the target a user has to hit.
            const wrapper = el.closest('label');
            const associated = el.id
              ? document.querySelector<HTMLElement>(`label[for="${CSS.escape(el.id)}"]`)
              : null;
            const label = wrapper || associated;
            if (label) {
              const lr = label.getBoundingClientRect();
              // The union of the two boxes: with a sibling label they sit side
              // by side, and the pair is what the user aims at.
              box = {
                width: Math.max(r.right, lr.right) - Math.min(r.left, lr.left),
                height: Math.max(r.bottom, lr.bottom) - Math.min(r.top, lr.top),
              } as DOMRect;
            }
          }
        }
        const { width: w, height: h } = box;
        if (w < MIN || h < MIN) {
          const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 2).join('.');
          results.push({
            selector: `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`,
            w: Math.round(w),
            h: Math.round(h),
            text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24),
          });
        }
      });
    return results;
  });
}

/** Flip the theme class and let the custom properties recalculate. */
export async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
  // The class flips CSS custom properties; give the style recalculation a frame
  // before sampling. Reading too early reports the previous theme's values and
  // manufactures failures that do not exist.
  await page.waitForTimeout(400);
}

export function reportContrast(route: string, theme: string, result: ContrastResult): string {
  const lines = result.failures.map(
    (f) =>
      `    ${f.ratio}:1 (needs ${f.required}:1)  ${f.selector}\n` +
      `      "${f.text}"\n` +
      `      ${f.foreground} on ${f.background} @ ${f.fontSize}px`
  );
  return (
    `${route} [${theme}]: ${result.failures.length} of ${result.sampled} sampled ` +
    `element(s) below WCAG AA\n${lines.join('\n')}`
  );
}
