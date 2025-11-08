import DOMPurify from 'dompurify';

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
 * Komponente zum sicheren Rendern von HTML
 * Verwendung: <div dangerouslySetInnerHTML={{ __html: sanitizeHTML(content) }} />
 */
export const sanitizeHTML = (html) => {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['b', 'i', 'u', 'strong', 'em', 'br', 'p'],
    ALLOWED_ATTR: []
  });
};

export default {
  sanitize,
  sanitizeHTML
};
