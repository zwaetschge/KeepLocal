// Pure i18n helpers shared by LanguageContext and tests.
// Kept free of React/JSX so `node --test` can import it directly.

/**
 * Replace `{token}` placeholders in a translation string with values from
 * `params`. Unknown tokens are left untouched so missing values stay visible
 * in reviews instead of silently disappearing.
 *
 * Examples:
 *   interpolate('Shared with {count}', { count: 3 })  // 'Shared with 3'
 *   interpolate('Hello {name}!', {})                  // 'Hello {name}!'
 *   interpolate('Hello!', { name: 'Mo' })             // 'Hello!'
 *
 * @param {string} template Translation template (may be undefined/null)
 * @param {Object<string, *>|null|undefined} params Values keyed by token name
 * @returns {string} Interpolated string
 */
export function interpolate(template, params) {
  if (template === undefined || template === null) return template;
  if (!params || typeof params !== 'object') return String(template);

  return String(template).replace(/\{([A-Za-z0-9_]+)\}/g, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      return String(params[key]);
    }
    return match;
  });
}
