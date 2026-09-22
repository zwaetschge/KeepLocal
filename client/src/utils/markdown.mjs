import DOMPurify from 'dompurify';
import { highlightMatches } from './sanitize.js';

/**
 * Markdown-Rendering der Karten (v1.13.0 Nr. 2): Der Großteil des Bestands
 * (Trilium-Import, 500+ Notizen) ist Markdown und wurde bislang als roher
 * Text mit Sternen und Rauten angezeigt.
 *
 * marked wird lazy geladen — Nutzer, die das Rendering abschalten (Setting
 * renderMarkdown), laden es nie; die erste Karte, die es braucht, zahlt den
 * dynamischen Import einmalig für die gesamte Session (Cache).
 */

// Allowlist fürs gerenderte Markdown: GFM-Ausgabe von marked, mehr nicht.
// input/checked/disabled gehören zu GFM-Task-Listen, img/src zu eingebetteten
// Bildern (relative /uploads/... bestehen DOMPurify, data:-URIs fliegen raus).
const MARKDOWN_ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code',
  'strong', 'em', 'del', 's', 'a', 'img', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'input', 'mark'
];
const MARKDOWN_ALLOWED_ATTR = [
  'href', 'target', 'rel', 'class', 'title', 'data-url',
  'src', 'alt', 'loading',
  'type', 'checked', 'disabled', 'start'
];

let markedLoader = null;

function loadMarked() {
  if (!markedLoader) {
    markedLoader = import('marked').then((module) => module.marked.parse);
  }
  return markedLoader;
}

/** DOMPurify-Hook: Markdown-Links bekommen target/rel wie die linkify-Links. */
function forceNewWindow(node) {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
}

/**
 * Markdown-Text zu sicherem HTML rendern.
 *
 * Reihenfolge: marked (GFM, breaks — einzeilige Umbrüche bleiben Umbrüche wie
 * im Plain-Text-Pfad) → DOMPurify mit Markdown-Allowlist → Such-Highlight
 * (markiert ausschließlich Textknoten, siehe highlightMatches).
 *
 * @param {string} text - Markdown-Quelltext
 * @param {string} [highlight] - Suchbegriff für <mark>-Hervorhebung
 * @returns {Promise<string>} sanitiztes HTML
 */
export async function renderMarkdown(text, highlight = '') {
  const parse = await loadMarked();
  const raw = parse(typeof text === 'string' ? text.replace(/\r\n/g, '\n') : '', {
    gfm: true,
    breaks: true
  });

  // Ohne DOM (node --test) exportiert dompurify nur {version, removed,
  // isSupported} — weder sanitize noch Hook-Registry. Dann läuft das geparste
  // HTML unverändert durch (Testumgebung); im Browser sind beide immer da.
  const canSanitize = typeof DOMPurify.sanitize === 'function';
  const canHook = canSanitize && typeof DOMPurify.addHook === 'function';

  // Hook nur um diesen einen sanitize-Aufruf spannen — add/sanitize/remove
  // ist synchron, ein parallel laufendes renderMarkdown kann den Hook des
  // anderen nicht wegnehmen.
  if (canHook) DOMPurify.addHook('afterSanitizeAttributes', forceNewWindow);
  let clean;
  try {
    clean = canSanitize
      ? DOMPurify.sanitize(raw, {
          ALLOWED_TAGS: MARKDOWN_ALLOWED_TAGS,
          ALLOWED_ATTR: MARKDOWN_ALLOWED_ATTR,
          KEEP_CONTENT: true
        })
      : raw;
  } finally {
    if (canHook) DOMPurify.removeHook('afterSanitizeAttributes');
  }

  return highlight ? highlightMatches(clean, highlight) : clean;
}

const markdownUtils = { renderMarkdown };

export default markdownUtils;
