/**
 * Admin-Guard-Check gegen eine echte MongoDB: beweist, dass sich eine Instanz
 * nicht selbst aussperren kann und dass der Notfall-Weg zurück funktioniert.
 *
 * Warum nicht nur Unit-Tests: Der erste Versuch (erst zählen, dann entmachten)
 * sah in gemockten Tests gut aus und verlor in der Realität trotzdem — zwei
 * Admins, die sich gleichzeitig entmachten, sehen beide "ein Admin bleibt" und
 * schreiben beide. Erst der Lauf gegen MongoDB hat das gezeigt. Standalone-Mongo
 * hat keine Transaktionen, also wird die Entmachtung ausgeführt und danach
 * verifiziert; wer einen leeren Admin-Satz sieht, nimmt seine eigene Änderung
 * zurück und antwortet 409.
 *
 * Geprüft wird:
 *   1. Race: beide Admins entmachten sich gleichzeitig -> mindestens ein Admin bleibt
 *   2. letzen Admin allein entmachten -> 409 LAST_ADMIN
 *   3. letzten Admin löschen -> 409 LAST_ADMIN
 *   4. Totalverlust (Alt-Datenbank) -> scripts/promote-admin.js stellt einen Admin her
 *
 * Usage:
 *   ADMIN_GUARD_MONGODB_URI=mongodb://127.0.0.1:27017/keeplocal_adminguard \
 *     npm run verify:admin-guard
 *
 * Safety: droppt die Ziel-Datenbank und läuft nur gegen Namen, die nach Test
 * aussehen (guard/e2e/test/ci), sonst nur mit ADMIN_GUARD_ALLOW_ANY_DB=1.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const mongoose = require('mongoose');

const SERVER_DIR = path.resolve(__dirname, '..');

// The user model hashes passwords on save; auth middleware is never loaded here,
// but a missing JWT_SECRET would abort unrelated requires.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'verify-admin-guard-secret-0123456789-abcdefghijkl';
}

function resolveUri() {
  const uri = process.env.ADMIN_GUARD_MONGODB_URI || process.env.E2E_MONGODB_URI || process.env.MONGODB_URI
    || 'mongodb://127.0.0.1:27017/keeplocal_adminguard';
  const dbName = new URL(uri).pathname.replace(/^\//, '');
  if (!/(guard|e2e|test|ci)/i.test(dbName) && process.env.ADMIN_GUARD_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `refusing to drop database "${dbName}": name does not look like a test database `
      + '(set ADMIN_GUARD_ALLOW_ANY_DB=1 to override)'
    );
  }
  return { uri, dbName };
}

const failures = [];
function check(condition, message) {
  console.log(`  ${condition ? 'ok  ' : 'FAIL'} ${message}`);
  if (!condition) failures.push(message);
}

async function main() {
  const { uri, dbName } = resolveUri();
  console.log(`[admin-guard] Ziel: ${dbName}`);

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const User = require(path.join(SERVER_DIR, 'models/User'));
  const adminService = require(path.join(SERVER_DIR, 'services/adminService'));

  await mongoose.connection.dropDatabase();
  const adminA = await User.create({
    username: 'guardadminA', email: 'guard-a@example.com', password: 'Secret123x',
    provider: 'local', isAdmin: true, isBootstrapAdmin: true
  });
  const adminB = await User.create({
    username: 'guardadminB', email: 'guard-b@example.com', password: 'Secret123x',
    provider: 'local', isAdmin: true
  });
  const normal = await User.create({
    username: 'guardnormal', email: 'guard-n@example.com', password: 'Secret123x',
    provider: 'local'
  });

  // 1) Race: zwei Admins entmachten sich gleichzeitig.
  const race = await Promise.allSettled([
    adminService.toggleUserAdmin(String(adminB._id), String(adminA._id)),
    adminService.toggleUserAdmin(String(adminA._id), String(adminB._id))
  ]);
  const adminsAfterRace = await User.countDocuments({ isAdmin: true });
  const rejectedWith409 = race.filter((result) => result.status === 'rejected' && result.reason?.code === 'LAST_ADMIN');
  console.log(`[admin-guard] Race: ${race.map((result) => result.status).join(',')} — Admins danach ${adminsAfterRace}`);
  check(adminsAfterRace >= 1, 'the concurrent-demotion race leaves at least one admin');
  check(rejectedWith409.length >= 1, 'at least one demotion is refused with LAST_ADMIN');

  // 2) Genau einen Admin lassen und versuchen, ihn zu entmachten.
  const survivor = await User.findOne({ isAdmin: true });
  await User.updateMany({ _id: { $ne: survivor._id } }, { $set: { isAdmin: false } });
  let lastAdminError = null;
  try {
    await adminService.toggleUserAdmin(String(survivor._id), String(normal._id));
  } catch (error) {
    lastAdminError = error;
  }
  check(lastAdminError?.statusCode === 409 && lastAdminError?.code === 'LAST_ADMIN',
    'demoting the last admin answers 409 LAST_ADMIN');
  check(await User.countDocuments({ isAdmin: true }) === 1, 'the last admin kept their rights');

  // 3) Letzten Admin löschen.
  let deleteError = null;
  try {
    await adminService.deleteUser(String(survivor._id), String(normal._id));
  } catch (error) {
    deleteError = error;
  }
  check(deleteError?.statusCode === 409 && deleteError?.code === 'LAST_ADMIN',
    'deleting the last admin answers 409 LAST_ADMIN');
  check(await User.countDocuments({ username: survivor.username }) === 1, 'the last admin was not deleted');

  // 4) Totalverlust simulieren und mit dem Notfall-Skript zurückholen.
  await User.updateMany({}, { $set: { isAdmin: false } });
  check(await User.countDocuments({ isAdmin: true }) === 0, 'simulated loss: no admin left');
  await mongoose.disconnect();

  const promoted = spawnSync(process.execPath, [path.join(SERVER_DIR, 'scripts/promote-admin.js'), 'guard-a@example.com'], {
    cwd: SERVER_DIR,
    env: { ...process.env, MONGODB_URI: uri },
    encoding: 'utf8'
  });
  const output = `${promoted.stdout || ''}${promoted.stderr || ''}`;
  check(promoted.status === 0, `promote-admin.js exits 0 (status=${promoted.status})`);
  check(/ist jetzt Admin/.test(output), 'promote-admin.js reports the promotion');
  check(!/Secret123x|\$2[aby]\$/.test(output), 'promote-admin.js never prints a password or hash');

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  const adminsAfterRecovery = await User.countDocuments({ isAdmin: true });
  const recovered = await User.findOne({ email: 'guard-a@example.com' });
  check(adminsAfterRecovery === 1, 'exactly one admin exists after the recovery');
  check(recovered?.isAdmin === true, 'the promoted account is an admin');
  await mongoose.disconnect();

  if (failures.length > 0) {
    console.error(`[admin-guard] FEHLGESCHLAGEN (${failures.length}): ${failures.join('; ')}`);
    process.exitCode = 1;
    return;
  }
  console.log('[admin-guard] OK — kein Aussperren möglich, Recovery-Weg funktioniert');
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[admin-guard] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main, resolveUri };
