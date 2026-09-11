import { useRef } from 'react';

/**
 * Backdrop-close handlers that ignore clicks ending on the backdrop when the
 * press started inside the modal (e.g. text-selection drags that are released
 * over the backdrop). Spread the returned props onto the overlay element.
 *
 * @param {Function} onClose - Called only for clicks that started AND ended on
 *   the backdrop itself.
 */
export function useBackdropClose(onClose) {
  const startedOnBackdrop = useRef(false);

  return {
    onMouseDown: (e) => {
      startedOnBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e) => {
      if (startedOnBackdrop.current && e.target === e.currentTarget) {
        onClose(e);
      }
    },
  };
}
