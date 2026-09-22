import { useEffect, useState } from 'react';
import { renderMarkdown } from '../utils/markdown.mjs';

/**
 * Rendert `text` als sanitiztes Markdown-HTML (v1.13.0).
 *
 * renderMarkdown ist async, weil marked lazy geladen wird — die Karte zeigt
 * bis zur ersten Antwort den gewohnten Plain-Text (sanitizt) und wechselt
 * dann. Läuft `enabled` auf false oder der Text weiter, wird das bis dahin
 * gerenderte HTML verworfen, damit nie der Inhalt einer anderen Notiz
 * durchblitzt.
 *
 * @param {string} text - Markdown-Quelltext der Notiz
 * @param {boolean} enabled - Setting an && keine Code-Notiz
 * @param {{highlight?: string}} [options] - Suchbegriff für <mark>
 * @returns {string|null} HTML oder null (noch nicht bereit / deaktiviert)
 */
export function useMarkdownHtml(text, enabled, { highlight } = {}) {
  const [html, setHtml] = useState(null);
  const term = typeof highlight === 'string' ? highlight : '';

  useEffect(() => {
    if (!enabled) {
      setHtml(null);
      return undefined;
    }
    // Veralteten Stand der vorherigen Notiz/des vorherigen Suchbegriffs
    // abräumen, bevor async neu gerendert wird.
    setHtml(null);
    let cancelled = false;
    renderMarkdown(text || '', term)
      .then((rendered) => { if (!cancelled) setHtml(rendered); })
      .catch(() => { if (!cancelled) setHtml(null); });
    return () => { cancelled = true; };
  }, [text, enabled, term]);

  return enabled ? html : null;
}
