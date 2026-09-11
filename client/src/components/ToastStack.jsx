import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import Toast from './Toast';
import { toastBus } from '../utils/toastBus.mjs';
import './Toast.css';

// ---------------------------------------------------------------------------
// ToastStack — the single queue host for `toastBus`.
//
// App.jsx publishes every notification through the bus (`showToast`), and the
// modals (NoteModal, FriendsModal, CollaborateModal, Settings) do the same, so
// all messages land in one queue: each toast keeps its own dismiss timer and a
// second message no longer replaces the first.
//
// <ToastStack /> is mounted once at the app root (App.jsx). The claim mechanism
// below additionally guarantees that extra hosts — e.g. one mounted inside a
// modal — never render the same queue twice, and that rendering hands over when
// the active host unmounts.
// ---------------------------------------------------------------------------

// Registry of currently mounted stacks (module level, like the bus itself).
const mountedStacks = new Set();
let activeRenderer = null;

function promoteNextRenderer() {
  const next = mountedStacks.values().next().value;
  if (next) {
    activeRenderer = next;
    next.setIsRenderer(true);
  } else {
    activeRenderer = null;
  }
}

function ToastStack() {
  const [toasts, setToasts] = useState(() => toastBus.getToasts());
  const [isRenderer, setIsRenderer] = useState(false);
  const instanceRef = useRef(null);

  useEffect(() => {
    const instance = { setIsRenderer };
    instanceRef.current = instance;
    mountedStacks.add(instance);
    if (activeRenderer === null) {
      activeRenderer = instance;
      setIsRenderer(true);
    }

    const unsubscribe = toastBus.subscribe(setToasts);

    return () => {
      unsubscribe();
      mountedStacks.delete(instance);
      if (activeRenderer === instance) {
        promoteNextRenderer();
      }
    };
  }, []);

  if (!isRenderer || typeof document === 'undefined') {
    return null;
  }

  return ReactDOM.createPortal(
    <div className="toast-stack">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => toastBus.dismiss(toast.id)}
        />
      ))}
    </div>,
    document.body
  );
}

export { toastBus };
export default ToastStack;
