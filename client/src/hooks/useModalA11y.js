import { useEffect, useId, useRef } from 'react';
import {
  computeTrapFocus,
  getFocusableElements,
  isTopDialog,
  pushDialog,
  removeDialog,
} from '../utils/modalA11y.mjs';

/**
 * Shared modal accessibility behaviour, extracted from ConfirmDialog so every
 * real overlay (NoteModal, FriendsModal, CollaborateModal, Settings, ...) gets
 * the same treatment:
 *
 *  - initial focus moves into the dialog (explicit ref, or the container when
 *    focus is still outside the dialog),
 *  - Tab / Shift+Tab are trapped inside the dialog container,
 *  - focus is restored to the invoking element when the dialog closes,
 *  - optional Escape-to-close (callers that own their own Escape handling,
 *    e.g. NoteModal via useModalShortcuts, pass `closeOnEscape: false`),
 *  - Nr. 28: nested dialogs are stacked — only the top-most one reacts to
 *    Escape and traps Tab, so a ConfirmDialog or lightbox above an editor
 *    never closes the dialog underneath with the same keypress.
 *
 * Usage:
 *   const { containerRef, titleId } = useModalA11y({ onClose });
 *   <div ref={containerRef} role="dialog" aria-modal="true"
 *        aria-labelledby={titleId} tabIndex={-1}> ... </div>
 *
 * NOTE: intentionally NOT re-exported from hooks/index.js while that file is
 * being reworked in parallel — import directly:
 *   import { useModalA11y } from '../hooks/useModalA11y';
 *
 * @param {Object} options
 * @param {string} [options.titleId] Fixed id for aria-labelledby; a stable
 *   useId-based id is generated when omitted.
 * @param {Function} [options.onClose] Called on Escape (when enabled).
 * @param {boolean} [options.active=true] Whether the modal is open. Used by
 *   components that stay mounted and return null when closed.
 * @param {boolean} [options.closeOnEscape=true] Set false when another
 *   shortcut system already owns Escape for this overlay.
 * @param {{current: Element|null}} [options.initialFocusRef] Element to focus
 *   when the dialog opens (e.g. the cancel button of a confirm dialog).
 * @returns {{containerRef: {current: Element|null}, titleId: string}}
 */
export function useModalA11y({
  titleId,
  onClose,
  active = true,
  closeOnEscape = true,
  initialFocusRef = null,
} = {}) {
  const generatedTitleId = useId();
  const resolvedTitleId = titleId || generatedTitleId;
  const containerRef = useRef(null);

  // Keep the close callback fresh without re-registering the key listener.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Nr. 28: same treatment for closeOnEscape. It MUST NOT be a dependency of
  // the main effect: when e.g. the admin console flips it to false because a
  // ConfirmDialog opened, a re-run would remove and re-push the console's
  // stack entry — landing it ABOVE the just-mounted confirm, which then never
  // sees Escape. The flag is read at event time instead.
  const closeOnEscapeRef = useRef(closeOnEscape);
  useEffect(() => {
    closeOnEscapeRef.current = closeOnEscape;
  }, [closeOnEscape]);

  const initialFocusTargetRef = useRef(initialFocusRef);
  initialFocusTargetRef.current = initialFocusRef;

  useEffect(() => {
    if (!active) return undefined;

    const container = containerRef.current;
    const entry = pushDialog();

    // Capture the invoking element BEFORE initial focus moves, so closing the
    // dialog restores focus to the caller (keyboard users otherwise land on
    // <body>).
    const previouslyFocused =
      typeof document !== 'undefined' ? document.activeElement : null;

    // Initial focus: explicit ref wins; otherwise pull focus into the dialog
    // only when it is still outside (React autoFocus on inner fields already
    // handled it). This preserves e.g. the note editor's title autofocus.
    let focusTarget = initialFocusTargetRef.current?.current || null;
    if (!focusTarget && container) {
      const current = typeof document !== 'undefined' ? document.activeElement : null;
      const focusInsideDialog = current && container.contains(current);
      if (!focusInsideDialog) focusTarget = container;
    }
    if (focusTarget && typeof focusTarget.focus === 'function') {
      focusTarget.focus();
    }

    const handleKeyDown = (event) => {
      // Nr. 28: only the top-most dialog owns the keyboard. A dialog with a
      // nested overlay above it (confirm inside admin console, lightbox
      // inside the editor) must stay silent on Escape and Tab.
      if (!isTopDialog(entry)) return;

      if (event.key === 'Escape' && closeOnEscapeRef.current) {
        // Keep the keypress from bubbling on to window-level listeners, so
        // legacy handlers there cannot ALSO act on the same Escape. (Same-node
        // document listeners still see it — callers that own their own Escape
        // logic must guard themselves, like NoteModal's lightbox check.)
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = getFocusableElements(containerRef.current);
      const trapTarget = computeTrapFocus(
        document.activeElement,
        focusableElements,
        event.shiftKey
      );
      if (trapTarget) {
        event.preventDefault();
        trapTarget.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      removeDialog(entry);
      document.removeEventListener('keydown', handleKeyDown);
      if (
        previouslyFocused &&
        typeof previouslyFocused.focus === 'function' &&
        previouslyFocused.isConnected !== false
      ) {
        previouslyFocused.focus();
      }
    };
    // closeOnEscape deliberately absent: see the ref above — a flip must not
    // re-push this dialog above overlays that mounted in between.
  }, [active]);

  return { containerRef, titleId: resolvedTitleId };
}
