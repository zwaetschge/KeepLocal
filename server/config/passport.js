const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const User = require('../models/User');

/**
 * Find or create a user from an OAuth profile.
 * If the email already exists with a local account, link the OAuth provider.
 */
async function findOrCreateOAuthUser(provider, profile) {
  const providerId = profile.id;
  const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
  const displayName = profile.displayName || profile.username || (email ? email.split('@')[0] : `${provider}-user-${providerId}`);
  const avatar = profile.photos && profile.photos[0] ? profile.photos[0].value : null;

  // First, try to find by provider + providerId
  let user = await User.findOne({ provider, providerId });
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
    user = await User.findOne({ email });
    if (user) {
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

  user = new User({
    username,
    email,
    provider,
    providerId,
    avatar,
    isAdmin: isFirstUser,
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
