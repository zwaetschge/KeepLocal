/**
 * Centralized error messages for the server
 * Provides consistent error responses across all endpoints
 */

module.exports = {
  // Authentication errors
  AUTH: {
    INVALID_CREDENTIALS: 'Ungültige Anmeldedaten',
    USER_NOT_FOUND: 'Benutzer nicht gefunden',
    USER_ALREADY_EXISTS: 'Benutzer existiert bereits',
    EMAIL_ALREADY_EXISTS: 'E-Mail-Adresse bereits registriert',
    USERNAME_ALREADY_EXISTS: 'Benutzername bereits vergeben',
    TOKEN_INVALID: 'Ungültiges Token',
    TOKEN_EXPIRED: 'Token abgelaufen',
    UNAUTHORIZED: 'Nicht autorisiert',
    ADMIN_REQUIRED: 'Administrator-Rechte erforderlich',
    SETUP_COMPLETE: 'Setup wurde bereits abgeschlossen',
    REGISTRATION_DISABLED: 'Registrierung ist deaktiviert',
    INITIAL_SETUP_REQUIRED: 'Initial setup required',
    SYSTEM_ALREADY_CONFIGURED: 'System already configured',
  },

  // Note errors
  NOTES: {
    NOT_FOUND: 'Notiz nicht gefunden',
    NO_ACCESS: 'Keine Berechtigung für diese Notiz',
    CREATION_FAILED: 'Fehler beim Erstellen der Notiz',
    UPDATE_FAILED: 'Fehler beim Aktualisieren der Notiz',
    DELETE_FAILED: 'Fehler beim Löschen der Notiz',
    INVALID_DATA: 'Ungültige Notizdaten',
    SHARE_FAILED: 'Fehler beim Teilen der Notiz',
  },

  // Friend errors
  FRIENDS: {
    NOT_FOUND: 'Freund nicht gefunden',
    REQUEST_NOT_FOUND: 'Freundschaftsanfrage nicht gefunden',
    ALREADY_FRIENDS: 'Bereits befreundet',
    REQUEST_ALREADY_SENT: 'Anfrage bereits gesendet',
    CANNOT_ADD_SELF: 'Sie können sich nicht selbst als Freund hinzufügen',
    REQUEST_FAILED: 'Fehler beim Senden der Freundschaftsanfrage',
  },

  // Admin errors
  ADMIN: {
    USER_NOT_FOUND: 'Benutzer nicht gefunden',
    CANNOT_DELETE_SELF: 'Sie können sich nicht selbst löschen',
    CANNOT_MODIFY_SELF: 'Sie können Ihre eigenen Admin-Rechte nicht ändern',
    UPDATE_FAILED: 'Fehler beim Aktualisieren',
  },

  // Validation errors
  VALIDATION: {
    REQUIRED_FIELDS: 'Erforderliche Felder fehlen',
    INVALID_EMAIL: 'Ungültige E-Mail-Adresse',
    INVALID_ID: 'Ungültige ID',
    PASSWORD_TOO_SHORT: 'Passwort zu kurz (mindestens 6 Zeichen)',
    INVALID_INPUT: 'Ungültige Eingabe',
  },

  // Generic errors
  GENERIC: {
    INTERNAL_ERROR: 'Interner Serverfehler',
    DATABASE_ERROR: 'Datenbankfehler',
    NOT_FOUND: 'Ressource nicht gefunden',
    BAD_REQUEST: 'Ungültige Anfrage',
  },
};
