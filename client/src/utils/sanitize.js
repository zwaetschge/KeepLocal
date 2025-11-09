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
    return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="note-link">${url}</a>`;
  });

  return linkedText;
};

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
 * Sanitizes and linkifies text content
 * @param {string} text - The text to process
 * @returns {string} - Sanitized HTML with clickable links
 */
export const sanitizeAndLinkify = (text) => {
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

  // Linkify URLs
  const linked = linkify(withBreaks);

  // Sanitize with allowed tags for links
  return DOMPurify.sanitize(linked, {
    ALLOWED_TAGS: ['a', 'br'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
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

export default {
  sanitize,
  sanitizeHTML,
  linkify,
  sanitizeAndLinkify
};
