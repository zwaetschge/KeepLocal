// Maps the stable API error codes (server/constants/errorCodes.js) to catalog
// keys, so a German-only server message no longer leaks into an English UI.
//
// Plain module (no React) so `node --test` can exercise the resolution logic.

/** code -> translation key in client/src/translations/{de,en}.js */
export const API_ERROR_KEYS = {
  // Notes and files
  NOTE_NOT_FOUND: 'errNoteNotFound',
  NOTE_OR_USER_NOT_FOUND: 'errNoteNotFound',
  NOTE_CONFLICT: 'errNoteConflict',
  IMAGE_LIMIT_REACHED: 'errImageLimitReached',
  IMAGES_REQUIRED: 'errImagesRequired',
  INVALID_FILENAME: 'errInvalidFilename',
  INVALID_AUDIO_FILE: 'errInvalidAudioFile',
  INVALID_IMAGE_FILE: 'errInvalidImageFile',
  AUDIO_REQUIRED: 'errAudioRequired',
  INVALID_LANGUAGE_CODE: 'errInvalidLanguageCode',
  FILE_TOO_LARGE: 'errFileTooLarge',
  UPLOAD_FAILED: 'errUploadFailed',
  TRANSCRIPTION_FAILED: 'errTranscriptionFailed',
  TRANSCRIPTION_EMPTY: 'errTranscriptionEmpty',
  AI_UNAVAILABLE: 'errAiUnavailable',
  URL_REQUIRED: 'errUrlRequired',
  LINK_UNREACHABLE: 'errLinkUnreachable',
  LINK_PREVIEW_FAILED: 'errLinkPreviewFailed',
  SHARE_REQUIRES_FRIEND: 'errShareRequiresFriend',
  FILE_NOT_FOUND: 'errFileNotFound',
  FILE_SERVE_FAILED: 'errFileServeFailed',

  // Auth and account
  AUTH_REQUIRED: 'errAuthRequired',
  SESSION_EXPIRED: 'errSessionExpired',
  SESSION_INVALID: 'errSessionExpired',
  INVALID_CREDENTIALS: 'errInvalidCredentials',
  ACCOUNT_ALREADY_EXISTS: 'errAccountAlreadyExists',
  EMAIL_ALREADY_EXISTS: 'errEmailAlreadyExists',
  USERNAME_ALREADY_EXISTS: 'errUsernameAlreadyExists',
  REGISTRATION_DISABLED: 'errRegistrationDisabled',
  DEMO_NOT_ENABLED: 'errDemoNotEnabled',
  OAUTH_NOT_CONFIGURED: 'errOauthNotConfigured',
  CURRENT_PASSWORD_INVALID: 'errCurrentPasswordInvalid',
  PASSWORD_UNCHANGED: 'errPasswordUnchanged',
  PASSWORD_NOT_SET: 'errPasswordNotSet',
  RESET_TOKEN_INVALID: 'errResetTokenInvalid',
  USE_CHANGE_PASSWORD: 'errUseChangePassword',

  // Users, admin, friends
  USER_NOT_FOUND: 'errUserNotFound',
  INVALID_USERNAME: 'errInvalidUsername',
  INVALID_USER_ID: 'errInvalidUserId',
  INVALID_EMAIL: 'errInvalidEmail',
  ACCESS_DENIED: 'errAccessDenied',
  ADMIN_REQUIRED: 'errAdminRequired',
  CANNOT_DELETE_SELF: 'errCannotDeleteSelf',
  CANNOT_MODIFY_SELF: 'errCannotModifySelf',
  FIELDS_REQUIRED: 'errFieldsRequired',
  INVALID_SETTINGS: 'errInvalidSettings',
  FRIEND_REQUEST_NOT_FOUND: 'errFriendRequestNotFound',
  INVALID_REQUEST_ID: 'errInvalidRequestId',
  ALREADY_FRIENDS: 'errAlreadyFriends',
  CANNOT_ADD_SELF: 'errCannotAddSelf',
  REQUEST_ALREADY_SENT: 'errRequestAlreadySent',
  REQUEST_ALREADY_RECEIVED: 'errRequestAlreadyReceived',
  REQUEST_ALREADY_HANDLED: 'errRequestAlreadyHandled',
  REQUEST_USER_GONE: 'errRequestUserGone',
  SEARCH_TOO_LONG: 'errSearchTooLong',

  // API keys
  API_KEY_REQUIRED: 'errApiKeyRequired',
  API_KEY_INVALID: 'errApiKeyInvalid',
  API_KEY_EXPIRED: 'errApiKeyExpired',
  API_KEY_NOT_FOUND: 'errApiKeyNotFound',
  INVALID_API_KEY_ID: 'errInvalidApiKeyId',
  INVALID_KEY_NAME: 'errInvalidKeyName',
  INVALID_KEY_EXPIRY: 'errInvalidKeyExpiry',
  API_KEY_LIMIT: 'errApiKeyLimit',

  // Cross cutting
  CSRF_INVALID: 'errCsrfInvalid',
  ORIGIN_NOT_ALLOWED: 'errOriginNotAllowed',
  RATE_LIMITED: 'errRateLimited',
  AUTH_RATE_LIMITED: 'errAuthRateLimited',
  INVALID_JSON: 'errInvalidJson',
  INVALID_ID: 'errInvalidId',
  DUPLICATE_ENTRY: 'errDuplicateEntry',
  VALIDATION_ERROR: 'errValidationError',
  BAD_REQUEST: 'errBadRequest',
  UNAUTHORIZED: 'errAuthRequired',
  FORBIDDEN: 'errAccessDenied',
  NOT_FOUND: 'errNotFound',
  CONFLICT: 'errConflict',
  PAYLOAD_TOO_LARGE: 'errFileTooLarge',
  UNPROCESSABLE_ENTITY: 'errValidationError',
  UPSTREAM_ERROR: 'errUpstreamError',
  SERVICE_UNAVAILABLE: 'errServiceUnavailable',
  INTERNAL_ERROR: 'errInternalError',
  ENDPOINT_NOT_FOUND: 'errNotFound',
  ERROR: 'errGeneric',
};

/**
 * Resolve the message to show for an API error.
 *
 * Prefers the translated text for a known code and falls back to the server's
 * own message (better a German sentence than "errNoteNotFound" on screen).
 *
 * @param {Error & {code?: string, status?: number}} error
 * @param {(key: string, params?: Object) => string} [t] translation function
 * @param {string} [fallbackKey='errGeneric'] key used when nothing else matches
 * @returns {string} Non-empty message
 */
export function resolveApiErrorMessage(error, t, fallbackKey = 'errGeneric') {
  const code = error?.code;
  if (code && typeof t === 'function') {
    const key = API_ERROR_KEYS[code];
    if (key) {
      const translated = t(key);
      // LanguageContext returns the key itself when a translation is missing.
      if (translated && translated !== key) return translated;
    }
  }

  const message = typeof error?.message === 'string' ? error.message.trim() : '';
  if (message && message !== 'Failed to fetch') return message;

  if (typeof t === 'function') {
    const fallback = t(fallbackKey);
    if (fallback && fallback !== fallbackKey) return fallback;
  }
  return message || 'Request failed';
}

const apiErrors = { API_ERROR_KEYS, resolveApiErrorMessage };
export default apiErrors;
