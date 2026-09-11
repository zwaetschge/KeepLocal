// Clipboard helper with a fallback for non-secure (HTTP) deployments where
// `navigator.clipboard` is unavailable or rejected by the browser.
// Pure module (no React) so `node --test` can exercise the fallback path with
// an injected document/navigator.

/**
 * Copy text to the clipboard. Tries the async Clipboard API first and falls
 * back to a hidden textarea + `document.execCommand('copy')` when the API is
 * missing (plain HTTP), fails, or is blocked by permissions.
 *
 * @param {string} text Text to copy
 * @param {{document?: Document, navigator?: Navigator}} [env] Injectable
 *   environment (defaults to the globals) — used by tests.
 * @returns {Promise<boolean>} true when the copy succeeded
 */
export async function copyToClipboard(text, env = {}) {
  const doc = env.document !== undefined ? env.document : globalThis.document;
  const nav = env.navigator !== undefined ? env.navigator : globalThis.navigator;

  if (nav && nav.clipboard && typeof nav.clipboard.writeText === 'function') {
    try {
      await nav.clipboard.writeText(String(text));
      return true;
    } catch {
      // Fall through to the legacy path (e.g. permission denied).
    }
  }

  return legacyCopy(text, doc);
}

function legacyCopy(text, doc) {
  if (!doc || typeof doc.createElement !== 'function' || !doc.body) {
    return false;
  }

  let textarea;
  try {
    textarea = doc.createElement('textarea');
  } catch {
    return false;
  }

  textarea.value = String(text);
  textarea.setAttribute('readonly', '');
  // Positioned off-screen and fixed so it never scrolls the page or flashes.
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  textarea.style.left = '-9999px';

  doc.body.appendChild(textarea);

  if (typeof textarea.select === 'function') {
    textarea.select();
  }
  if (typeof textarea.setSelectionRange === 'function') {
    textarea.setSelectionRange(0, String(text).length);
  }

  let copied = false;
  try {
    copied = doc.execCommand('copy');
  } catch {
    copied = false;
  }

  doc.body.removeChild(textarea);
  return Boolean(copied);
}
