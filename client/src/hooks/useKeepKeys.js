import { useEffect } from 'react';
export function useKeepKeys({
  enabled,
  noteFormRef,
  searchBarRef,
  onSelect,
  onArchive,
  onOpen,
  notes,
}) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (
        e.defaultPrevented ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.shiftKey ||
        e.isComposing ||
        document.querySelector('[role="dialog"], .note-modal')
      )
        return;
      if (
        e.target.closest?.(
          'input,textarea,select,button,a[href],summary,[role="button"],[role="link"],[contenteditable="true"],[role="textbox"]',
        )
      )
        return;
      const cards = [...document.querySelectorAll('[data-note-id]')];
      const index = cards.findIndex(
        (card) =>
          card === document.activeElement ||
          card.contains(document.activeElement),
      );
      const id = cards[index]?.dataset.noteId;
      let handled = true;
      switch (e.key) {
        case 'c':
          noteFormRef.current?.focus('text');
          break;
        case 'l':
          noteFormRef.current?.focus('list');
          break;
        case '/':
          searchBarRef.current?.focus();
          break;
        case 'j':
        case 'k': {
          const next =
            e.key === 'j'
              ? Math.min(cards.length - 1, index + 1)
              : Math.max(0, index - 1);
          cards[next]?.focus();
          break;
        }
        case 'x':
          if (id) onSelect(id);
          break;
        case 'e':
          if (id) onArchive(id);
          break;
        case 'Enter':
          if (id) onOpen(notes.find((n) => n._id === id));
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, noteFormRef, searchBarRef, onSelect, onArchive, onOpen, notes]);
}
