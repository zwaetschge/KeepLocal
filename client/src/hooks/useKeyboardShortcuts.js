import { useEffect } from 'react';

/**
 * Hook for registering global keyboard shortcuts
 * Handles Ctrl/Cmd key combinations
 *
 * @param {Object} shortcuts - Map of shortcuts to handlers
 * @param {boolean} enabled - Whether shortcuts are enabled (default: true)
 *
 * @example
 * useKeyboardShortcuts({
 *   'Ctrl+N': () => console.log('New note'),
 *   'Ctrl+F': () => searchRef.current.focus(),
 *   'Ctrl+K': toggleTheme,
 *   'Ctrl+Shift+L': logout,
 *   'Escape': closeModal,
 *   'Ctrl+Enter': saveNote,
 * }, isLoggedIn);
 */
export function useKeyboardShortcuts(shortcuts = {}, enabled = true) {
  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (e) => {
      // Build key combination string
      const parts = [];
      if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
      if (e.shiftKey) parts.push('Shift');
      if (e.altKey) parts.push('Alt');
      parts.push(e.key);

      const combination = parts.join('+');

      // Check if this combination has a handler
      const handler = shortcuts[combination];
      if (handler) {
        e.preventDefault();
        handler(e);
        return;
      }

      // Also check for just the key (for Escape, Enter, etc.)
      if (shortcuts[e.key]) {
        const keyHandler = shortcuts[e.key];
        // Only handle if it's a special key (not a letter/number)
        if (['Escape', 'Enter', 'Tab', 'Backspace', 'Delete'].includes(e.key)) {
          e.preventDefault();
          keyHandler(e);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [shortcuts, enabled]);
}

/**
 * Hook for modal keyboard shortcuts (Escape to close, Ctrl+Enter to save)
 *
 * @param {Function} onClose - Function to call when Escape is pressed
 * @param {Function} onSave - Function to call when Ctrl+Enter is pressed
 * @param {Array} deps - Dependencies that should trigger re-registration
 *
 * @example
 * useModalShortcuts(handleClose, handleSave, [title, content]);
 */
export function useModalShortcuts(onClose, onSave, deps = []) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      // ESC to close
      if (e.key === 'Escape') {
        onClose();
      }
      // Ctrl/Cmd + Enter to save
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        onSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onSave, ...deps]);
}

export default useKeyboardShortcuts;
