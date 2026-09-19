export const THEMES = ['light', 'dark', 'oled', 'eink', 'doodle'];
export const LANGUAGES = ['de', 'en'];

export const DEFAULT_SETTINGS = {
  theme: 'light',
  aiFeatures: {
    voiceTranscription: false
  },
  transcriptionLanguage: 'auto',
  // v1.10.0: Tag-Farben (Name → Hex), gespeicherte Suchen, Journal-Ordner
  tagColors: {},
  savedSearches: [],
  journalFolderId: null
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Tag colors: Name → Hex, limited like the server (≤200, 6-digit hex). */
function normalizeTagColors(value) {
  if (!isRecord(value)) return {};
  const colors = {};
  let count = 0;
  for (const [tag, hex] of Object.entries(value)) {
    if (count >= 200) break;
    if (typeof tag === 'string' && tag.length <= 100
      && typeof hex === 'string' && /^#[0-9a-fA-F]{6}$/.test(hex)) {
      colors[tag] = hex.toLowerCase();
      count += 1;
    }
  }
  return colors;
}

/** Saved searches: {id, name, query, typeFilter, tag}, ≤20 like the server. */
function normalizeSavedSearches(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .slice(0, 20)
    .map((search) => ({
      id: typeof search.id === 'string' && search.id.length <= 40 ? search.id : null,
      name: typeof search.name === 'string' && search.name.trim()
        ? search.name.trim().slice(0, 80)
        : null,
      query: typeof search.query === 'string' ? search.query.slice(0, 200) : '',
      typeFilter: typeof search.typeFilter === 'string' && search.typeFilter.length <= 20
        ? search.typeFilter
        : null,
      tag: typeof search.tag === 'string' && search.tag.length <= 100 ? search.tag : null
    }))
    .filter((search) => search.id && search.name);
}

/**
 * Normalize a settings/preferences object into exactly the shape the app uses.
 * Unknown keys are dropped, invalid values fall back to the defaults — the same
 * rules the server applies, so a stale localStorage copy or a partial server
 * payload can never put the UI into an undefined state.
 *
 * @param {Object|null|undefined} value
 * @returns {{theme: string, aiFeatures: {voiceTranscription: boolean}, transcriptionLanguage: string}}
 */
export function normalizeSettings(value) {
  const source = isRecord(value) ? value : {};
  const aiFeatures = isRecord(source.aiFeatures) ? source.aiFeatures : {};
  const transcriptionLanguage = typeof source.transcriptionLanguage === 'string'
    && source.transcriptionLanguage.length <= 20
    ? source.transcriptionLanguage
    : DEFAULT_SETTINGS.transcriptionLanguage;

  return {
    theme: THEMES.includes(source.theme) ? source.theme : DEFAULT_SETTINGS.theme,
    aiFeatures: {
      voiceTranscription: aiFeatures.voiceTranscription === true
    },
    transcriptionLanguage,
    tagColors: normalizeTagColors(source.tagColors),
    savedSearches: normalizeSavedSearches(source.savedSearches),
    journalFolderId: typeof source.journalFolderId === 'string'
      && /^[0-9a-f]{24}$/.test(source.journalFolderId)
      ? source.journalFolderId
      : null
  };
}

/**
 * Preferences of the authenticated user (from /api/auth/me) as settings.
 * @param {Object|null|undefined} user
 */
export function settingsFromUser(user) {
  return normalizeSettings(isRecord(user) ? user.preferences : null);
}

/**
 * Payload for PUT /api/auth/preferences.
 * @param {Object} settings - normalized settings
 */
export function preferencesFromSettings(settings) {
  const normalized = normalizeSettings(settings);
  return {
    theme: normalized.theme,
    aiFeatures: { voiceTranscription: normalized.aiFeatures.voiceTranscription },
    transcriptionLanguage: normalized.transcriptionLanguage,
    tagColors: normalized.tagColors,
    savedSearches: normalized.savedSearches,
    journalFolderId: normalized.journalFolderId
  };
}

/**
 * Structural comparison, so a server echo does not look like a local change
 * (which would trigger another write and could loop).
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function settingsEqual(a, b) {
  const left = normalizeSettings(a);
  const right = normalizeSettings(b);
  return left.theme === right.theme
    && left.transcriptionLanguage === right.transcriptionLanguage
    && left.aiFeatures.voiceTranscription === right.aiFeatures.voiceTranscription
    && left.journalFolderId === right.journalFolderId
    && JSON.stringify(left.tagColors) === JSON.stringify(right.tagColors)
    && JSON.stringify(left.savedSearches) === JSON.stringify(right.savedSearches);
}

const settingsPayload = {
  THEMES,
  LANGUAGES,
  DEFAULT_SETTINGS,
  normalizeSettings,
  settingsFromUser,
  preferencesFromSettings,
  settingsEqual
};

export default settingsPayload;
