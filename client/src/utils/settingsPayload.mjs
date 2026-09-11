export const THEMES = ['light', 'dark', 'oled', 'eink', 'doodle'];
export const LANGUAGES = ['de', 'en'];

export const DEFAULT_SETTINGS = {
  theme: 'light',
  aiFeatures: {
    voiceTranscription: false
  },
  transcriptionLanguage: 'auto'
};

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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
    transcriptionLanguage
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
    transcriptionLanguage: normalized.transcriptionLanguage
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
    && left.aiFeatures.voiceTranscription === right.aiFeatures.voiceTranscription;
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
