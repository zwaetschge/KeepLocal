/**
 * Stable machine-readable error codes for every API response.
 *
 * Why: the API answered with German prose only ("Notiz nicht gefunden"), so
 * browser clients could not translate errors and external `/api/v1` consumers
 * had to string-match localized text. Every response that carries `error` now
 * also carries a `code` (see middleware/errorCodes.js), the client maps known
 * codes to catalog keys, and the prose stays as a fallback for older clients.
 *
 * Adding a new user-facing error? Add its exact message here and a matching
 * `err_<CODE>` key to client/src/translations/{de,en}.js — the contract test
 * fails when a code has no translation.
 */

/** Exact server message -> stable code. */
const MESSAGE_TO_CODE = {
  // Notes
  'Notiz nicht gefunden': 'NOTE_NOT_FOUND',
  'Notiz oder Benutzer nicht gefunden': 'NOTE_OR_USER_NOT_FOUND',
  'Die Notiz wurde inzwischen geändert': 'NOTE_CONFLICT',
  'Maximal 25 Bilder pro Notiz erlaubt': 'IMAGE_LIMIT_REACHED',
  'Keine Bilder hochgeladen': 'IMAGES_REQUIRED',
  'Ungueltiger Dateiname': 'INVALID_FILENAME',
  'Ungueltige Audio-Datei': 'INVALID_AUDIO_FILE',
  'Ungueltige Bild-Datei': 'INVALID_IMAGE_FILE',
  'Keine Audio-Datei gesendet': 'AUDIO_REQUIRED',
  'Ungueltiger Sprachcode': 'INVALID_LANGUAGE_CODE',
  'Datei zu groß. Maximale Dateigröße: 25MB': 'FILE_TOO_LARGE',
  'Upload-Fehler': 'UPLOAD_FAILED',
  'Fehler bei der Transkription': 'TRANSCRIPTION_FAILED',
  'AI Service ist nicht erreichbar. Läuft der Container?': 'AI_UNAVAILABLE',
  'Keine Transkription erhalten': 'TRANSCRIPTION_EMPTY',
  'URL ist erforderlich und darf maximal 2048 Zeichen lang sein': 'URL_REQUIRED',
  'Link ist nicht erreichbar': 'LINK_UNREACHABLE',
  'Fehler beim Abrufen der Link-Vorschau': 'LINK_PREVIEW_FAILED',
  'Notizen koennen nur mit Freunden geteilt werden': 'SHARE_REQUIRES_FRIEND',

  // Files
  'Datei nicht gefunden': 'FILE_NOT_FOUND',
  'Datei nicht auf dem Server gefunden': 'FILE_NOT_FOUND',
  'Fehler beim Laden der Datei': 'FILE_SERVE_FAILED',

  // Auth
  'Authentifizierung erforderlich': 'AUTH_REQUIRED',
  'Sitzung ist nicht mehr gueltig': 'SESSION_EXPIRED',
  'Token abgelaufen': 'SESSION_EXPIRED',
  'Ungültiges Token': 'SESSION_INVALID',
  'Ungültige Anmeldedaten': 'INVALID_CREDENTIALS',
  'Benutzername oder E-Mail-Adresse bereits vergeben': 'ACCOUNT_ALREADY_EXISTS',
  'E-Mail-Adresse bereits vergeben': 'EMAIL_ALREADY_EXISTS',
  'Benutzername bereits vergeben': 'USERNAME_ALREADY_EXISTS',
  'Registrierung ist derzeit deaktiviert. Bitte kontaktieren Sie einen Administrator.': 'REGISTRATION_DISABLED',
  'Registrierung ist in der oeffentlichen Demo deaktiviert.': 'REGISTRATION_DISABLED',
  'Demo ist nicht aktiviert': 'DEMO_NOT_ENABLED',
  'OAuth ist in der Demo nicht konfiguriert': 'OAUTH_NOT_CONFIGURED',
  'Google OAuth is not configured': 'OAUTH_NOT_CONFIGURED',
  'GitHub OAuth is not configured': 'OAUTH_NOT_CONFIGURED',
  'Fehler beim Prüfen des Setup-Status': 'INTERNAL_ERROR',
  'Fehler beim Prüfen des Registrierungsstatus': 'INTERNAL_ERROR',
  'Aktuelles Passwort ist falsch': 'CURRENT_PASSWORD_INVALID',
  'Das neue Passwort muss sich vom bisherigen unterscheiden': 'PASSWORD_UNCHANGED',
  'Dieses Konto wird per OAuth angemeldet und hat kein lokales Passwort.': 'PASSWORD_NOT_SET',
  'Reset-Token ist ungültig oder abgelaufen': 'RESET_TOKEN_INVALID',
  'Für das eigene Konto bitte "Passwort ändern" in den Einstellungen verwenden': 'USE_CHANGE_PASSWORD',

  // Users / admin / friends
  'Benutzer nicht gefunden': 'USER_NOT_FOUND',
  'Ungueltiger Benutzername': 'INVALID_USERNAME',
  'Ungueltige Benutzer-ID': 'INVALID_USER_ID',
  'Ungültige Benutzer-ID': 'INVALID_USER_ID',
  'Ungültige E-Mail-Adresse': 'INVALID_EMAIL',
  'Ungültige Benutzer-ID ': 'INVALID_USER_ID',
  'Zugriff verweigert': 'ACCESS_DENIED',
  'Zugriff verweigert. Admin-Rechte erforderlich.': 'ADMIN_REQUIRED',
  'Sie können sich nicht selbst löschen': 'CANNOT_DELETE_SELF',
  'Sie können Ihren eigenen Admin-Status nicht ändern': 'CANNOT_MODIFY_SELF',
  'Benutzername, E-Mail und Passwort sind erforderlich': 'FIELDS_REQUIRED',
  'registrationEnabled muss ein Boolean sein': 'INVALID_SETTINGS',
  'Anfrage nicht gefunden': 'FRIEND_REQUEST_NOT_FOUND',
  'Ungueltige Anfrage-ID': 'INVALID_REQUEST_ID',
  'Bereits Freunde': 'ALREADY_FRIENDS',
  'Du kannst dich nicht selbst als Freund hinzufügen': 'CANNOT_ADD_SELF',
  'Anfrage bereits gesendet oder bereits befreundet': 'REQUEST_ALREADY_SENT',
  'Anfrage bereits gesendet': 'REQUEST_ALREADY_SENT',
  'Von diesem Benutzer liegt bereits eine Anfrage vor': 'REQUEST_ALREADY_RECEIVED',
  'Anfrage wurde bereits bearbeitet': 'REQUEST_ALREADY_HANDLED',
  'Anfragender Benutzer existiert nicht mehr': 'REQUEST_USER_GONE',
  'Suchbegriff darf maximal 100 Zeichen lang sein': 'SEARCH_TOO_LONG',

  // API keys
  'API-Key erforderlich. Sende den Key im X-API-Key Header.': 'API_KEY_REQUIRED',
  'Ungültiger API-Key': 'API_KEY_INVALID',
  'API-Key abgelaufen': 'API_KEY_EXPIRED',
  'API-Key nicht gefunden': 'API_KEY_NOT_FOUND',
  'Ungueltige API-Key-ID': 'INVALID_API_KEY_ID',
  'Name muss zwischen 1 und 100 Zeichen lang sein': 'INVALID_KEY_NAME',
  'expiresIn muss 30d, 90d, 365d oder never sein': 'INVALID_KEY_EXPIRY',
  'Maximal 10 API-Keys pro Benutzer erlaubt': 'API_KEY_LIMIT',

  // Cross cutting
  'Ungueltiges CSRF-Token': 'CSRF_INVALID',
  'Origin ist nicht erlaubt': 'ORIGIN_NOT_ALLOWED',
  'Zu viele Anfragen von dieser IP, bitte versuchen Sie es spaeter erneut.': 'RATE_LIMITED',
  'Zu viele Anmeldeversuche. Bitte versuchen Sie es spaeter erneut.': 'AUTH_RATE_LIMITED',
  'Ungueltiger JSON-Request': 'INVALID_JSON',
  'Ungueltige ID': 'INVALID_ID',
  'Ein Eintrag mit diesen Daten existiert bereits': 'DUPLICATE_ENTRY',
  'Validierungsfehler': 'VALIDATION_ERROR',
  'Ein Serverfehler ist aufgetreten': 'INTERNAL_ERROR',
  'API-Endpunkt nicht gefunden': 'ENDPOINT_NOT_FOUND'
};

/** Fallback per HTTP status, so every error response carries a code. */
const STATUS_TO_CODE = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'RATE_LIMITED',
  500: 'INTERNAL_ERROR',
  502: 'UPSTREAM_ERROR',
  503: 'SERVICE_UNAVAILABLE'
};

/**
 * Resolve the stable code for an error response.
 * @param {string} message - The `error` text of the response body
 * @param {number} status - HTTP status code of the response
 * @returns {string} Stable code, never empty
 */
function codeForMessage(message, status) {
  if (typeof message === 'string' && MESSAGE_TO_CODE[message]) {
    return MESSAGE_TO_CODE[message];
  }
  return STATUS_TO_CODE[status] || 'ERROR';
}

module.exports = {
  MESSAGE_TO_CODE,
  STATUS_TO_CODE,
  codeForMessage,
  ALL_CODES: Array.from(new Set([...Object.values(MESSAGE_TO_CODE), ...Object.values(STATUS_TO_CODE), 'ERROR']))
};
