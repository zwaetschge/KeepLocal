import DOMPurify from 'dompurify';

/**
 * Converts URLs in text to clickable links
 * @param {string} text - The text containing URLs
 * @returns {string} - HTML with clickable links
 */
export const linkify = (text) => {
  if (typeof text !== 'string') {
    return text;
  }

  // URL regex pattern
  const urlPattern = /(https?:\/\/[^\s]+)/g;

  // Replace URLs with anchor tags
  const linkedText = text.replace(urlPattern, (url) => {
    // Extract domain for tooltip
    const domain = url.match(/https?:\/\/([^/]+)/)?.[1] || url;

    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-link" data-url="${url}" title="${domain}">${url}</a>`;
  });

  return linkedText;
};

/**
 * Converts todo checkboxes to interactive HTML checkboxes
 * @param {string} text - The text containing todo items
 * @returns {string} - HTML with interactive checkboxes
 */
export const parseTodos = (text) => {
  if (typeof text !== 'string') {
    return text;
  }

  // Match todo items: [ ] or [x] or [X]
  // Support both at start of line and after line break
  const todoPattern = /(\[[ xX]\])/g;

  const withTodos = text.replace(todoPattern, (match) => {
    const isChecked = match.toLowerCase().includes('x');
    return `<label class="todo-item"><input type="checkbox" class="todo-checkbox" ${isChecked ? 'checked' : ''} /><span class="todo-label"></span></label>`;
  });

  return withTodos;
};

const escapeRegExpSource = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const escapeHtmlText = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

/**
 * Wrap occurrences of `needle` in <mark> — but only in text nodes, never inside
 * a tag or attribute (the input is already escaped and linkified HTML).
 *
 * @param {string} html - escaped HTML produced by sanitizeAndLinkify
 * @param {string} needle - raw search term as typed by the user
 * @returns {string}
 */
export function highlightMatches(html, needle) {
  if (typeof html !== 'string') return html;
  const term = typeof needle === 'string' ? needle.trim() : '';
  if (!term) return html;

  // The haystack is escaped HTML, so the needle has to be escaped the same way
  // ("Tom <3" is stored as "Tom &lt;3").
  const escapedNeedle = escapeHtmlText(term);
  const pattern = new RegExp(escapeRegExpSource(escapedNeedle), 'gi');

  return html
    .split(/(<[^>]*>)/g)
    .map(part => (part.startsWith('<') ? part : part.replace(pattern, match => `<mark>${match}</mark>`)))
    .join('');
}

/**
 * Bereinigt HTML-Inhalt von XSS-Angriffen
 * @param {string} dirty - Der zu bereinigende String
 * @returns {string} - Der bereinigte String
 */
export const sanitize = (dirty) => {
  if (typeof dirty !== 'string') {
    return dirty;
  }

  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'br', 'p'],
    ALLOWED_ATTR: [],
    KEEP_CONTENT: true
  });
};

/**
 * Sanitizes and linkifies text content with todo support
 * @param {string} text - The text to process
 * @param {{highlight?: string}} [options] - Optional search term to mark
 * @returns {string} - Sanitized HTML with clickable links and todos
 */
export const sanitizeAndLinkify = (text, options = {}) => {
  if (typeof text !== 'string') {
    return text;
  }

  // First escape HTML entities to prevent XSS
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  // Convert newlines to <br> tags
  const withBreaks = escaped.replace(/\n/g, '<br>');

  // Parse todo checkboxes
  const withTodos = parseTodos(withBreaks);

  // Linkify URLs
  const linked = linkify(withTodos);

  // Search highlighting runs on the escaped/linkified HTML and only touches text
  // nodes, so it can neither create attributes nor break a link URL.
  const highlighted = options.highlight ? highlightMatches(linked, options.highlight) : linked;

  // Sanitize with allowed tags for links, todos, and checkboxes
  return DOMPurify.sanitize(highlighted, {
    ALLOWED_TAGS: ['a', 'br', 'label', 'input', 'span', 'mark'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class', 'type', 'checked', 'data-url', 'title'],
    KEEP_CONTENT: true
  });
};

/**
 * Komponente zum sicheren Rendern von HTML
 * Verwendung: <div dangerouslySetInnerHTML={{ __html: sanitizeHTML(content) }} />
 */
export const sanitizeHTML = (html) => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'br', 'p', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class']
  });
};

const sanitizeUtils = {
  sanitize,
  sanitizeHTML,
  linkify,
  highlightMatches,
  sanitizeAndLinkify,
  parseTodos
};

export default sanitizeUtils;
