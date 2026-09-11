/**
 * Reset the database (and the local uploads directory) for the Playwright
 * smoke tests. The suite starts from the "initial setup" screen, so it needs an
 * empty database on every run.
 *
 * Usage:
 *   E2E_MONGODB_URI=mongodb://127.0.0.1:27017/keeplocal_e2e node scripts/e2e-reset-db.js
 *   (MONGODB_URI works too; E2E_MONGODB_URI wins so the Playwright config and
 *   this script can share one variable.)
 *
 * Safety: refuses to run unless the target database name looks like a test
 * database (or E2E_ALLOW_ANY_DB=1 is set), so a misconfigured MONGODB_URI cannot
 * wipe a real deployment.
 */
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');

const uploadsImagesDir = path.resolve(__dirname, '../uploads/images');
const uploadsTempDir = path.resolve(__dirname, '../uploads/temp');

function cleanUploads() {
  for (const dir of [uploadsImagesDir, uploadsTempDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (entry === '.gitkeep') continue;
      fs.rmSync(path.join(dir, entry), { recursive: true, force: true });
    }
  }
}

async function main() {
  const uri = process.env.E2E_MONGODB_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('E2E_MONGODB_URI (or MONGODB_URI) is required');
  }

  const dbName = new URL(uri).pathname.replace(/^\//, '');
  const looksLikeTestDb = /(e2e|test|ci)/i.test(dbName);
  if (!looksLikeTestDb && process.env.E2E_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `refusing to drop database "${dbName}": name does not look like a test database ` +
      '(set E2E_ALLOW_ANY_DB=1 to override)'
    );
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  cleanUploads();
  console.log(`[e2e-reset-db] dropped "${dbName}" and cleaned uploads`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[e2e-reset-db] failed:', error.message);
    process.exit(1);
  });
}

module.exports = { main };
