// Minimal publish/subscribe bus for toast notifications.
//
// App.jsx keeps a single toast state (owned by B1/integrator), so components
// that need stacked toasts publish here instead: any mounted <ToastStack />
// (src/components/ToastStack.jsx, which re-exports this bus) renders the
// queue. Plain module — no React — so `node --test` can verify the semantics.

const MAX_VISIBLE_TOASTS = 4;

const listeners = new Set();
let toasts = [];
let nextToastId = 1;

function emit() {
  for (const listener of listeners) {
    listener(toasts);
  }
}

export const toastBus = {
  /**
   * Show a toast. Messages are capped so a runaway error loop cannot fill
   * the screen; the newest toasts win.
   * @param {string} message
   * @param {'info'|'success'|'error'|'warning'} [type]
   * @param {number} [duration] Auto-dismiss delay in ms
   * @param {{label: string, onClick: Function}|null} [action] Optional button
   *   (e.g. "Undo" after moving a note to the trash). Clicking it dismisses the
   *   toast, so the action cannot fire twice.
   * @returns {number|null} Toast id (for dismiss) or null when ignored
   */
  publish(message, type = 'info', duration = 3000, action = null) {
    if (message === undefined || message === null || message === '') {
      return null;
    }
    const id = nextToastId++;
    const normalizedAction = action && typeof action.onClick === 'function' && action.label
      ? { label: String(action.label), onClick: action.onClick }
      : null;
    toasts = [...toasts, { id, message: String(message), type, duration, action: normalizedAction }].slice(
      -MAX_VISIBLE_TOASTS
    );
    emit();
    return id;
  },

  success(message, duration) {
    return toastBus.publish(message, 'success', duration);
  },

  error(message, duration) {
    return toastBus.publish(message, 'error', duration);
  },

  warning(message, duration) {
    return toastBus.publish(message, 'warning', duration);
  },

  info(message, duration) {
    return toastBus.publish(message, 'info', duration);
  },

  /** Remove a single toast (close button / after handling). */
  dismiss(id) {
    if (toasts.every((toast) => toast.id !== id)) return;
    toasts = toasts.filter((toast) => toast.id !== id);
    emit();
  },

  /** Remove all toasts. */
  clear() {
    if (toasts.length === 0) return;
    toasts = [];
    emit();
  },

  /**
   * Subscribe to queue changes. The listener immediately receives the
   * current queue so late-mounted stacks start in sync.
   * @returns {Function} unsubscribe
   */
  subscribe(listener) {
    listeners.add(listener);
    listener(toasts);
    return () => listeners.delete(listener);
  },

  /** Current queue snapshot (tests / initial React state). */
  getToasts() {
    return toasts;
  },
};
