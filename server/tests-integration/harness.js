/**
 * Gemeinsames Harness für die Integrations-Tests gegen eine echte MongoDB.
 *
 * Warum diese Suite existiert (Audit 2026-09-12, Top-30 Nr. 23): Die
 * Server-Suite lief ausschließlich gegen gemockte Modelle. MongoDB-Semantik —
 * `$expr`/`$size`, partielle und TTL-Indizes, Aggregationen, `explain()`,
 * Unique-Verletzungen — war damit prinzipiell ungeprüft. Genau dort saßen zwei
 * der teuersten Funde: der fehlende Index auf `images.filename` (COLLSCAN pro
 * Thumbnail) und die Papierkorb-Zählungen.
 *
 * Die Suite läuft nur mit INTEGRATION_MONGODB_URI und nur gegen Datenbanken,
 * deren Name nach Test aussieht — sie droppt die Datenbank zu Beginn.
 */
const path = require('node:path');
const mongoose = require('mongoose');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'integration-test-secret-0123456789-abcdefghijkl';
process.env.NODE_ENV = 'test';

function resolveUri() {
  const uri = process.env.INTEGRATION_MONGODB_URI || process.env.E2E_MONGODB_URI;
  if (!uri) {
    return null;
  }
  const dbName = new URL(uri).pathname.replace(/^\//, '');
  if (!/(integration|e2e|test|ci)/i.test(dbName) && process.env.INTEGRATION_ALLOW_ANY_DB !== '1') {
    throw new Error(
      `refusing to drop database "${dbName}": name does not look like a test database `
      + '(set INTEGRATION_ALLOW_ANY_DB=1 to override)'
    );
  }
  return uri;
}

const INTEGRATION_URI = resolveUri();

/** Lädt die Modelle frisch, damit Indizes pro Lauf neu registriert werden. */
function models() {
  return {
    Note: require('../models/Note'),
    User: require('../models/User'),
    ApiKey: require('../models/ApiKey')
  };
}

async function syncAllIndexes() {
  // Modelle explizit laden: `mongoose.models` ist leer, bis jemand sie
  // require'd — sonst läuft syncIndexes() über ein leeres Register und die
  // Collections bleiben ohne Indizes.
  models();
  for (const model of Object.values(mongoose.models)) {
    await model.syncIndexes();
  }
}

async function connect() {
  if (!INTEGRATION_URI) return false;
  await mongoose.connect(INTEGRATION_URI, { serverSelectionTimeoutMS: 15000 });
  await mongoose.connection.dropDatabase();
  // Indizes so anlegen, wie der Server-Startup es tut (syncIndexes seit #113).
  await syncAllIndexes();
  return true;
}

async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

async function resetDatabase() {
  await mongoose.connection.dropDatabase();
  await syncAllIndexes();
}

async function seedUser(overrides = {}) {
  const { User } = models();
  return User.create({
    username: overrides.username || `user-${Math.random().toString(36).slice(2, 8)}`,
    email: overrides.email || `user-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: 'Integration1x',
    provider: 'local',
    ...overrides
  });
}

async function seedNote(userId, overrides = {}) {
  const { Note } = models();
  return Note.create({
    userId,
    title: overrides.title || 'Integrations-Notiz',
    content: overrides.content || 'Inhalt',
    ...overrides
  });
}

/** Index-Namen einer Collection. */
async function indexNames(collectionName) {
  const indexes = await mongoose.connection.db.collection(collectionName).indexes();
  return indexes.map(index => index.name);
}

async function explainQuery(collectionName, filter) {
  const plan = await mongoose.connection.db.collection(collectionName).find(filter).explain('executionStats');
  const stages = [];
  const walk = (node) => {
    if (!node) return;
    if (node.stage) stages.push(node.stage);
    if (node.inputStage) walk(node.inputStage);
    if (node.inputStages) node.inputStages.forEach(walk);
  };
  walk(plan.queryPlanner?.winningPlan);
  return { stages, stats: plan.executionStats };
}

module.exports = {
  INTEGRATION_URI,
  models,
  connect,
  disconnect,
  resetDatabase,
  seedUser,
  seedNote,
  indexNames,
  explainQuery,
  uploadsImagesDir: path.resolve(__dirname, '../uploads/images')
};
