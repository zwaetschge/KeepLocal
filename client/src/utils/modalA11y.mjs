// Pure focus-trap helpers extracted from the modal accessibility hook.
// DOM-free decision logic + a small DOM query helper, kept in a plain module
// so `node --test` can verify the trap behaviour without a browser.

/**
 * Selector matching elements that are keyboard focusable unless disabled or
 * removed from the tab order via tabindex="-1".
 */
export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ');

/**
 * Visibility check that tolerates fake elements in tests: an element with
 * `getClientRects` is visible when it produces at least one box (excludes
 * `display: none` ancestors, e.g. the hidden file input in the note editor).
 */
export function isVisible(element) {
  if (!element) return false;
  if (typeof element.getClientRects === 'function') {
    return element.getClientRects().length > 0;
  }
  return true;
}

/**
 * All keyboard-focusable, visible elements inside a container, in DOM order.
 *
 * @param {Element|null} container
 * @returns {Element[]}
 */
export function getFocusableElements(container) {
  if (!container || typeof container.querySelectorAll !== 'function') {
    return [];
  }
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter(isVisible);
}

/**
 * Decide which element the focus trap should move focus to on Tab /
 * Shift+Tab. Returns `null` to let the browser handle the key (focus is on a
 * middle element or the list is empty).
 *
 * @param {Element|null} activeElement Currently focused element
 * @param {Element[]} focusableElements Focusable elements of the dialog
 * @param {boolean} shiftKey true for Shift+Tab
 * @returns {Element|null} Element to focus, or null for default behaviour
 */
export function computeTrapFocus(activeElement, focusableElements, shiftKey) {
  if (!Array.isArray(focusableElements) || focusableElements.length === 0) {
    return null;
  }

  const first = focusableElements[0];
  const last = focusableElements[focusableElements.length - 1];

  if (shiftKey) {
    return activeElement === first ? last : null;
  }
  return activeElement === last ? first : null;
}

/**
 * Nr. 28 (Top-30): registry of the currently open dialogs. Only the TOP-MOST
 * entry may react to Escape and run the Tab trap — otherwise a nested overlay
 * (lightbox over the note editor, ConfirmDialog over the admin console) also
 * triggers the dialog underneath and both close at once. Registration order
 * equals hook-effect order equals mount order, so overlays mounted later win.
 */
const dialogStack = [];

export function pushDialog() {
  const entry = {};
  dialogStack.push(entry);
  return entry;
}

export function removeDialog(entry) {
  const index = dialogStack.indexOf(entry);
  if (index !== -1) dialogStack.splice(index, 1);
}

export function isTopDialog(entry) {
  return dialogStack.length > 0 && dialogStack[dialogStack.length - 1] === entry;
}
