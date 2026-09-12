/**
 * Notfall-Werkzeug: einem bestehenden Konto wieder Admin-Rechte geben.
 *
 * Warum es das gibt: Passwort-Wiederherstellung läuft ausschließlich über ein
 * admin-erzeugtes Einmal-Token (`POST /api/admin/users/:id/password-reset`,
 * hinter `requireAdmin`), und einen SMTP-Pfad gibt es nicht. Ohne Admin ist die
 * Instanz also von der UI aus nicht mehr zu retten — kein Admin → kein
 * Reset-Token → kein Passwort → kein Admin. Seit dem Rest-Admin-Guard
 * (`adminService.assertNotLastAdmin`) sollte das nicht mehr passieren; dieses
 * Skript ist der Weg zurück, falls es doch passiert (Alt-Datenbank, manuelle
 * Mongo-Änderung, Import).
 *
 * Usage:
 *   MONGODB_URI=mongodb://127.0.0.1:27017/keeplocal \
 *     node scripts/promote-admin.js <username-oder-email> [--dry-run]
 *
 *   # All-in-One-Container:
 *   docker exec keeplocal node /app/server/scripts/promote-admin.js admin@example.com
 *
 * Hinweise:
 * - `authenticateToken` lädt den Nutzer bei jedem Request aus der Datenbank,
 *   die Rechte gelten also sofort — kein Neulogin nötig.
 * - Das Skript ändert nur `isAdmin`. `isBootstrapAdmin` (einzigartiger Index
 *   `single_bootstrap_admin`) bleibt unangetastet.
 * - Es werden keine Passwörter oder Tokens ausgegeben.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const normalizeEmailAddress = require('../utils/normalizeEmail');

function usage(message) {
  if (message) console.error(`Fehler: ${message}`);
  console.error('Usage: node scripts/promote-admin.js <username-oder-email> [--dry-run]');
  process.exit(message ? 2 : 1);
}

async function findAccount(identifier) {
  const looksLikeEmail = identifier.includes('@');
  if (looksLikeEmail) {
    const normalized = normalizeEmailAddress(identifier);
    return User.findOne({
      $or: [{ email: normalized }, { email: identifier.toLowerCase() }]
    }).select('-password');
  }
  // Usernames are stored case-sensitively; a recovery run should not fail on
  // casing, so match exactly first and then case-insensitively.
  const exact = await User.findOne({ username: identifier }).select('-password');
  if (exact) return exact;
  const candidates = await User.find({
    username: { $regex: new RegExp(`^${identifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }
  }).select('-password').limit(2);
  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`mehrdeutiger Benutzername (${candidates.map((user) => user.username).join(', ')}) — bitte E-Mail verwenden`);
  }
  return null;
}

async function main(argv) {
  const args = argv.filter((arg) => !arg.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  if (args.length !== 1) usage('genau ein Benutzername oder eine E-Mail-Adresse angeben');

  const uri = process.env.MONGODB_URI;
  if (!uri) usage('MONGODB_URI ist nicht gesetzt');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  try {
    const user = await findAccount(args[0]);
    if (!user) {
      console.error(`Kein Konto für "${args[0]}" gefunden.`);
      process.exitCode = 1;
      return;
    }

    const admins = await User.countDocuments({ isAdmin: true });
    console.log(`Konto: ${user.username} <${user.email}> — isAdmin=${Boolean(user.isAdmin)}, Admins gesamt=${admins}`);

    if (user.isAdmin) {
      console.log('Nichts zu tun: das Konto ist bereits Admin.');
      return;
    }
    if (dryRun) {
      console.log('--dry-run: würde isAdmin=true setzen.');
      return;
    }

    await User.updateOne({ _id: user._id }, { $set: { isAdmin: true } });
    const after = await User.countDocuments({ isAdmin: true });
    console.log(`✓ ${user.username} ist jetzt Admin (Admins gesamt=${after}).`);
    console.log('Die Rechte gelten ab dem nächsten Request; ein Neulogin ist nicht nötig.');
    console.log('Danach: Passwort-Reset-Token in der AdminConsole erzeugen, falls das Passwort unbekannt ist.');
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('promote-admin fehlgeschlagen:', error.message);
    process.exit(1);
  });
}

module.exports = { main, findAccount };
