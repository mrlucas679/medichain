/**
 * Everything the browser will place in the tab order, as one selector.
 *
 * Shared by <FocusTrap/> and useFocusTrap. It sits in its own module because
 * a .tsx that exports both a component and a constant cannot Fast Refresh.
 */
export const FOCUSABLE_SELECTORS = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ');
