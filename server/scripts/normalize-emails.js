// One-off migration: canonicalize stored email addresses to the same form the
// register/login validators produce (BUG_REPORT 2026-08-15, #5 follow-up).
//
// Legacy accounts created via admin console or OAuth may store emails that were
// only trim().toLowerCase()'d (dotted Gmail, sub-addressing). No login input
// can ever match those, so the accounts are locked out. This script rewrites
// every stored email through the shared normalizeEmailAddress() helper.
//
// Usage:
//   MONGODB_URI=mongodb://localhost:27017/keeplocal node scripts/normalize-emails.js          # dry run (default)
//   MONGODB_URI=mongodb://localhost:27017/keeplocal node scripts/normalize-emails.js --write  # apply changes
//
// Take a database backup (see README "Backup & Restore") before --write.
// Collisions — two users canonicalizing to the same address — are never
// rewritten automatically; they are reported for manual resolution instead.
const mongoose = require('mongoose');
const User = require('../models/User');
const normalizeEmailAddress = require('../utils/normalizeEmail');

/**
 * Plan the migration for a list of users (as returned by User.find().lean()).
 * Pure function — separated from main() so it can be tested without MongoDB.
 * @returns {{pending: Array<{user, from: string, to: string}>,
 *            collisions: Array<{user, canonical: string, rival}>}}
 */
function planEmailMigration(users) {
  // Alle User pro Kanonikform sammeln — ein bereits kanonischer Besitzer
  // blockiert die Umschreibung eines zweiten Accounts auf dieselbe Adresse.
  const usersByCanonical = new Map();
  for (const user of users) {
    const canonical = normalizeEmailAddress(user.email);
    const bucket = usersByCanonical.get(canonical) || [];
    bucket.push(user);
    usersByCanonical.set(canonical, bucket);
  }

  const pending = [];
  const collisions = [];
  for (const user of users) {
    const canonical = normalizeEmailAddress(user.email);
    if (canonical === user.email) continue;

    const rival = (usersByCanonical.get(canonical) || [])
      .find(other => String(other._id) !== String(user._id));
    if (rival) {
      collisions.push({ user, canonical, rival });
      continue;
    }
    pending.push({ user, from: user.email, to: canonical });
  }
  return { pending, collisions };
}

async function main() {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required (see server/.env.example)');
  }
  const write = process.argv.includes('--write');

  await mongoose.connect(process.env.MONGODB_URI);
  const users = await User.find({}).select('username email provider').lean();
  const { pending, collisions } = planEmailMigration(users);

  console.log(`Users checked: ${users.length}`);
  console.log(`Emails already canonical: ${users.length - pending.length - collisions.length}`);
  console.log(`Emails to ${write ? 'update' : 'update (dry run)'}: ${pending.length}`);
  for (const { from, to } of pending) {
    console.log(`  ${from}  ->  ${to}`);
  }
  console.log(`Collisions (never rewritten, resolve manually): ${collisions.length}`);
  for (const { user, canonical, rival } of collisions) {
    console.log(`  ${user.email} and ${rival.email} both canonicalize to ${canonical}`);
  }

  if (!write) {
    console.log('\nDry run only — re-run with --write to apply.');
  } else if (pending.length > 0) {
    for (const { user, to } of pending) {
      await User.updateOne({ _id: user._id }, { email: to });
    }
    console.log(`\nUpdated ${pending.length} email(s).`);
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(error => {
    console.error('Migration fehlgeschlagen:', error.message);
    process.exit(1);
  });
}

module.exports = { planEmailMigration };
