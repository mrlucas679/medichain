import { useEffect, useState } from 'react';

// Split out of CommandPalette.tsx: a module that exports both a component
// and a hook defeats Fast Refresh, so an edit to either forced a full reload
// and lost the open palette's state.
/**
 * Hook to manage command palette state with keyboard shortcut
 */
export function useCommandPalette() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) };
}
