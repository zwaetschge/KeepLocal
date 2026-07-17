export function resolveBrowserLanguage(
  navigatorObject,
  supportedLanguages,
  fallbackLanguage
) {
  let rawLanguage;

  try {
    rawLanguage = navigatorObject?.language;
  } catch {
    return fallbackLanguage;
  }

  if (typeof rawLanguage !== 'string') {
    return fallbackLanguage;
  }

  const browserLanguage = rawLanguage.trim().split(/[-_]/)[0].toLowerCase();
  if (
    browserLanguage &&
    Object.prototype.hasOwnProperty.call(supportedLanguages, browserLanguage)
  ) {
    return browserLanguage;
  }

  return fallbackLanguage;
}

export function getBrowserLanguage(supportedLanguages, fallbackLanguage) {
  let navigatorObject;

  try {
    navigatorObject = globalThis.navigator;
  } catch {
    return fallbackLanguage;
  }

  return resolveBrowserLanguage(
    navigatorObject,
    supportedLanguages,
    fallbackLanguage
  );
}
