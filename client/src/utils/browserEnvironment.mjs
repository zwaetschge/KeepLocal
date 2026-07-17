const THEME_CLASSES = ['dark-mode', 'oled-mode', 'eink-mode', 'doodle-mode'];
const THEME_CLASS_BY_NAME = {
  dark: 'dark-mode',
  oled: 'oled-mode',
  eink: 'eink-mode',
  doodle: 'doodle-mode'
};

function resolveGlobalProperty(propertyName) {
  try {
    return globalThis[propertyName] || null;
  } catch {
    return null;
  }
}

export function applyThemeToDocument(theme, documentObject = resolveGlobalProperty('document')) {
  try {
    const classList = documentObject?.body?.classList;
    if (!classList || typeof classList.remove !== 'function') return false;

    classList.remove(...THEME_CLASSES);
    const themeClass = THEME_CLASS_BY_NAME[theme];
    if (themeClass) {
      if (typeof classList.add !== 'function') return false;
      classList.add(themeClass);
    }

    return true;
  } catch {
    return false;
  }
}

export function getBrowserPathname(windowObject = resolveGlobalProperty('window')) {
  try {
    const pathname = windowObject?.location?.pathname;
    return typeof pathname === 'string' ? pathname : '/';
  } catch {
    return '/';
  }
}

export function subscribeToWindowEvent(
  eventName,
  listener,
  windowObject = resolveGlobalProperty('window')
) {
  try {
    if (!windowObject || typeof windowObject.addEventListener !== 'function') {
      return () => {};
    }

    windowObject.addEventListener(eventName, listener);
    return () => {
      try {
        if (typeof windowObject.removeEventListener === 'function') {
          windowObject.removeEventListener(eventName, listener);
        }
      } catch {
        // The browser may revoke access while the page is open.
      }
    };
  } catch {
    return () => {};
  }
}
