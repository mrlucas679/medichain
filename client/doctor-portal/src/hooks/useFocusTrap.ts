import { useCallback, useRef } from 'react';
import { FOCUSABLE_SELECTORS } from '../components/focusableSelectors';

// Split out of FocusTrap.tsx for the same reason as useCommandPalette: a
// module exporting a component and a hook cannot Fast Refresh.
/**
 * Hook for programmatic focus trap management
 * 
 * @example
 * ```tsx
 * const { trapRef, activate, deactivate } = useFocusTrap();
 * ```
 */
export function useFocusTrap() {
  const trapRef = useRef<HTMLDivElement>(null);
  const previousElement = useRef<Element | null>(null);

  const activate = useCallback(() => {
    previousElement.current = document.activeElement;
    
    if (trapRef.current) {
      const focusable = trapRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS);
      if (focusable.length > 0) {
        focusable[0].focus();
      }
    }
  }, []);

  const deactivate = useCallback(() => {
    if (previousElement.current instanceof HTMLElement) {
      previousElement.current.focus();
    }
  }, []);

  return { trapRef, activate, deactivate };
}
