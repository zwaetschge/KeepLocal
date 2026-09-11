const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '../src', ...parts), 'utf8');

// Improvement #2 (VERBESSERUNGEN_2026-09-11): there was no way to change or
// reset a password at all — a forgotten password meant a dead account, which is
// what made the old email-canonicalisation bug permanent.

test('the API layer exposes password change and one-time reset', () => {
  const constants = read('constants', 'api.js');
  assert.match(constants, /CHANGE_PASSWORD: '\/api\/auth\/change-password'/);
  assert.match(constants, /RESET_PASSWORD: '\/api\/auth\/reset-password'/);
  assert.match(constants, /PASSWORD_RESET: \(userId\) => `\/api\/admin\/users\/\$\{userId\}\/password-reset`/);

  const authApi = read('services', 'api', 'authAPI.js');
  assert.match(authApi, /changePassword: async \(currentPassword, newPassword\)/);
  assert.match(authApi, /resetPassword: async \(token, newPassword\)/);
  // Both go through the CSRF-retrying POST helper, so a stale token cannot
  // strand the user on a 403.
  assert.equal(authApi.match(/postWithCsrfRetry\(API_ENDPOINTS\.AUTH\.(CHANGE|RESET)_PASSWORD/g)?.length, 2);

  const adminApi = read('services', 'api', 'adminAPI.js');
  assert.match(adminApi, /createPasswordReset: \(userId\)/);
});

test('settings let the user change their own password', () => {
  const settings = read('components', 'Settings.jsx');

  assert.match(settings, /authAPI\.changePassword\(pwCurrent, pwNew\)/);
  assert.match(settings, /id="current-password"/);
  assert.match(settings, /id="new-password"/);
  assert.match(settings, /id="confirm-new-password"/);
  assert.match(settings, /autoComplete="current-password"/);
  assert.match(settings, /autoComplete="new-password"/);
  // Same strength rules as registration, checked before the request.
  assert.match(settings, /validateNewPassword/);
  assert.match(settings, /t\('passwordsDontMatch'\)/);
  assert.match(settings, /role="alert"/);
  assert.match(settings, /toastBus\.success\(t\('passwordChanged'\)\)/);
  assert.match(settings, /t\('passwordChangeSessionsHint'\)/);
});

test('the login screen can redeem an admin reset token', () => {
  const login = read('components', 'Login.jsx');

  assert.match(login, /authAPI\.resetPassword\(resetToken\.trim\(\), resetPassword\)/);
  assert.match(login, /t\('forgotPassword'\)/);
  assert.match(login, /id="reset-token"/);
  assert.match(login, /autoComplete="one-time-code"/);
  assert.match(login, /passwordStrengthError/);
  assert.match(login, /t\('resetPasswordSuccess'\)/);
  // The raw token is never logged or persisted.
  assert.doesNotMatch(login, /console\.(log|info|warn|error)\([^)]*resetToken/);
  assert.doesNotMatch(login, /localStorage[^)]*resetToken/);
});

test('the admin console issues a one-time reset token', () => {
  const admin = read('components', 'AdminConsole.jsx');

  assert.match(admin, /adminAPI\.createPasswordReset\(user\._id\)/);
  assert.match(admin, /className="btn-reset-token"/);
  assert.match(admin, /t\('adminResetPassword'\)/);
  // Shown once, copyable, dismissable.
  assert.match(admin, /reset-token-box/);
  assert.match(admin, /copyToClipboard\(resetTokenInfo\.token\)/);
  assert.match(admin, /t\('resetTokenHint'\)/);
  assert.match(admin, /toastBus\.success\(t\('resetTokenCreatedTitle'\)\)/);
});

test('both catalogs carry every password key', () => {
  const keysOf = (file) => {
    const source = fs.readFileSync(path.join(__dirname, '../src/translations', file), 'utf8');
    return new Set(Array.from(source.matchAll(/^  ([A-Za-z0-9_]+):/gm), (m) => m[1]));
  };
  const de = keysOf('de.js');
  const en = keysOf('en.js');

  const required = [
    'changePasswordSection', 'changePasswordDescription', 'currentPassword', 'newPassword',
    'changePassword', 'passwordChanged', 'passwordChangeFailed', 'passwordChangeSessionsHint',
    'forgotPassword', 'resetPasswordTitle', 'resetPasswordDescription', 'resetTokenLabel',
    'resetPasswordButton', 'resetPasswordSuccess', 'resetPasswordFailed', 'adminResetPassword',
    'resetTokenCreatedTitle', 'resetTokenHint', 'resetTokenFailed',
  ];
  for (const key of required) {
    assert.ok(de.has(key), `de.js is missing ${key}`);
    assert.ok(en.has(key), `en.js is missing ${key}`);
  }
});
