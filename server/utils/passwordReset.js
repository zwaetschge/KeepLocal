const crypto = require('crypto');

/**
 * One-time password reset tokens.
 *
 * Self-hosted KeepLocal has no mail delivery by default, so an administrator
 * generates a short-lived token in the admin console and hands it to the user
 * (chat, password manager, printed slip). Only the SHA-256 hash is stored, so a
 * database leak does not hand out working reset tokens — the same reasoning as
 * for API keys.
 */

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * Create a raw token (shown once) and its stored hash.
 * @returns {{ token: string, tokenHash: string, expiresAt: Date }}
 */
function createPasswordResetToken() {
  const token = crypto.randomBytes(32).toString('hex');
  return {
    token,
    tokenHash: hashPasswordResetToken(token),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS)
  };
}

/**
 * @param {string} token - Raw token as handed to the user
 * @returns {string} Hex-encoded SHA-256 hash used for lookup
 */
function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

module.exports = {
  RESET_TOKEN_TTL_MS,
  createPasswordResetToken,
  hashPasswordResetToken
};
