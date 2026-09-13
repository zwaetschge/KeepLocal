const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const User = require('../models/User');
const Settings = require('../models/Settings');
const normalizeEmailAddress = require('../utils/normalizeEmail');

/**
 * Pick the email entry to trust for this OAuth profile.
 *
 * GitHub is configured with `allRawEmails: true`, so profile.emails maps the
 * full /user/emails response and every entry keeps its `verified`/`primary`
 * flags; Google mirrors `email_verified` into profile.emails[].verified. We
 * prefer a verified + primary address, then any verified one, and only fall
 * back to the unverified entries for brand-new accounts — linking an existing
 * account additionally requires a verified pick (isEmailVerifiedForLinking).
 */
function pickOAuthEmail(profile) {
  const entries = Array.isArray(profile.emails) ? profile.emails : [];
  const withValue = entries.filter(entry => entry && typeof entry.value === 'string');
  const verified = withValue.filter(entry => entry.verified === true);
  return (
    verified.find(entry => entry.primary === true)
    || verified[0]
    || withValue.find(entry => entry.primary === true)
    || withValue[0]
    || null
  );
}

/**
 * Provider-specific proof that the chosen email is verified. Deliberately no
 * OR across providers: GitHub's /user response has no verification flag, so
 * accepting a Google-style `profile._json.email_verified` for a GitHub profile
 * would lower the bar to "any email GitHub merely reports". For Google both
 * spots carry the same flag (the openid profile mapping copies
 * `email_verified` into emails[].verified).
 */
function isEmailVerifiedForLinking(provider, profile, rawEmail) {
  const entry = Array.isArray(profile.emails)
    ? profile.emails.find(candidate => candidate && candidate.value === rawEmail)
    : null;
  if (provider === 'github') {
    return entry?.verified === true;
  }
  return entry?.verified === true || profile._json?.email_verified === true;
}

/**
 * Find or create a user from an OAuth profile.
 * If the email already exists with a local account, link the OAuth provider.
 */
async function findOrCreateOAuthUser(provider, profile) {
  const providerId = profile.id;
  const emailEntry = pickOAuthEmail(profile);
  const rawEmail = emailEntry ? emailEntry.value : null;
  // Look up and store the same canonical form the register/login validators
  // produce, so an OAuth identity finds the existing local account instead of
  // creating a duplicate.
  const email = rawEmail ? normalizeEmailAddress(rawEmail) : null;
  const displayName = profile.displayName || profile.username || (email ? email.split('@')[0] : `${provider}-user-${providerId}`);
  const avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

  // First, try to find by provider + providerId
  let user = await User.findOne({ provider, providerId }).select('+sessionVersion');
  if (user) {
    // Update avatar if changed
    if (avatar && user.avatar !== avatar) {
      user.avatar = avatar;
      await user.save();
    }
    return user;
  }

  // If we have an email, check if a local account exists with that email
  if (email) {
    user = await User.findOne({ email }).select('+sessionVersion');
    if (user) {
      if (!isEmailVerifiedForLinking(provider, profile, rawEmail)) {
        const error = new Error('OAuth email must be verified before linking an existing account');
        error.code = 'oauth_email_unverified';
        throw error;
      }

      // Link OAuth to existing account
      user.provider = provider;
      user.providerId = providerId;
      if (avatar) user.avatar = avatar;
      await user.save();
      return user;
    }
  }

  if (!email) {
    throw new Error('OAuth provider did not return an email address. Please ensure your account has a public email.');
  }

  // Create a new user — generate a unique username
  let username = displayName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 50);
  if (username.length < 3) {
    username = `${provider}_${providerId}`.substring(0, 50);
  }

  // Ensure username uniqueness
  const existingUsername = await User.findOne({ username });
  if (existingUsername) {
    username = `${username}_${Date.now().toString(36)}`.substring(0, 50);
  }

  // Check if this is the first user (make admin)
  const userCount = await User.countDocuments();
  const isFirstUser = userCount === 0;

  if (!isFirstUser) {
    const settings = await Settings.findById('1');
    if (!settings?.registrationEnabled) {
      const error = new Error('Registrierung ist derzeit deaktiviert');
      error.statusCode = 403;
      throw error;
    }
  }

  user = new User({
    username,
    email,
    provider,
    providerId,
    avatar,
    isAdmin: isFirstUser,
    isBootstrapAdmin: isFirstUser,
  });

  await user.save();
  return user;
}

function configurePassport() {
  // Serialize user ID into session
  passport.serializeUser((user, done) => {
    done(null, user._id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const user = await User.findById(id).select('-password');
      done(null, user);
    } catch (err) {
      done(err, null);
    }
  });

  // Google OAuth Strategy
  if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/api/auth/google/callback',
      scope: ['profile', 'email'],
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateOAuthUser('google', profile);
        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }));
    console.log('Google OAuth strategy configured');
  }

  // GitHub OAuth Strategy
  if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
      clientID: process.env.GITHUB_CLIENT_ID,
      clientSecret: process.env.GITHUB_CLIENT_SECRET,
      callbackURL: process.env.GITHUB_CALLBACK_URL || '/api/auth/github/callback',
      scope: ['user:email'],
      // Without this the strategy collapses GET /user/emails to the primary
      // address alone and drops the `verified` flag — the linking check below
      // then rejected every GitHub login of an existing local account.
      allRawEmails: true,
    }, async (accessToken, refreshToken, profile, done) => {
      try {
        const user = await findOrCreateOAuthUser('github', profile);
        done(null, user);
      } catch (err) {
        done(err, null);
      }
    }));
    console.log('GitHub OAuth strategy configured');
  }
}

module.exports = { configurePassport, findOrCreateOAuthUser };
