const crypto = require('crypto');
const mongoose = require('mongoose');
const ApiKey = require('../models/ApiKey');
const Note = require('../models/Note');
const Settings = require('../models/Settings');
const User = require('../models/User');
const { isDemoMode } = require('../middleware/demoPolicy');

const DEFAULT_RESET_INTERVAL_HOURS = 6;
const MAX_RESET_INTERVAL_HOURS = 168;
const DEMO_NOTE_IDS = [
  '66d000000000000000000001',
  '66d000000000000000000002',
  '66d000000000000000000003',
  '66d000000000000000000004'
];

function parseResetIntervalHours(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_RESET_INTERVAL_HOURS;
  return Math.min(parsed, MAX_RESET_INTERVAL_HOURS);
}

function getDemoConfig(environment = process.env) {
  const username = (environment.DEMO_USERNAME || 'demo').trim();
  const email = (environment.DEMO_USER_EMAIL || 'demo@keeplocal.invalid').trim().toLowerCase();

  if (!/^[a-zA-Z0-9_-]{3,50}$/.test(username)) {
    throw new Error('DEMO_USERNAME must contain 3 to 50 safe characters');
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error('DEMO_USER_EMAIL must be a valid email address');
  }

  return {
    username,
    email,
    resetIntervalHours: parseResetIntervalHours(environment.DEMO_RESET_INTERVAL_HOURS)
  };
}

function buildDemoFixtures(userId, referenceTime = new Date()) {
  const timestamp = new Date(referenceTime);
  if (Number.isNaN(timestamp.getTime())) {
    throw new Error('A valid reference time is required');
  }

  const createdAt = (minutesAgo) => new Date(timestamp.getTime() - minutesAgo * 60 * 1000);

  return [
    {
      _id: new mongoose.Types.ObjectId(DEMO_NOTE_IDS[0]),
      title: 'Willkommen bei KeepLocal',
      content: 'Diese oeffentliche Demo zeigt dir die wichtigsten Notizfunktionen. Probiere Farben, Tags, Suche, Anheften und Archivieren aus.',
      color: '#aecbfa',
      isPinned: true,
      isArchived: false,
      tags: ['demo', 'willkommen'],
      images: [],
      isTodoList: false,
      todoItems: [],
      linkPreviews: [],
      userId,
      sharedWith: [],
      createdAt: createdAt(40),
      updatedAt: createdAt(40)
    },
    {
      _id: new mongoose.Types.ObjectId(DEMO_NOTE_IDS[1]),
      title: 'Ideen fuer den Wochenendausflug',
      content: 'Picknick am See\nKleine Wanderung\nKamera und Kartenspiel einpacken',
      color: '#fff475',
      isPinned: false,
      isArchived: false,
      tags: ['ideen', 'privat'],
      images: [],
      isTodoList: false,
      todoItems: [],
      linkPreviews: [],
      userId,
      sharedWith: [],
      createdAt: createdAt(30),
      updatedAt: createdAt(30)
    },
    {
      _id: new mongoose.Types.ObjectId(DEMO_NOTE_IDS[2]),
      title: 'Demo-Checkliste',
      content: '',
      color: '#ccff90',
      isPinned: false,
      isArchived: false,
      tags: ['demo', 'todo'],
      images: [],
      isTodoList: true,
      todoItems: [
        { text: 'Eine neue Notiz anlegen', completed: true, order: 0 },
        { text: 'Eine Farbe auswaehlen', completed: false, order: 1 },
        { text: 'Nach einem Tag filtern', completed: false, order: 2 }
      ],
      linkPreviews: [],
      userId,
      sharedWith: [],
      createdAt: createdAt(20),
      updatedAt: createdAt(20)
    },
    {
      _id: new mongoose.Types.ObjectId(DEMO_NOTE_IDS[3]),
      title: 'Archivierte Beispielnotiz',
      content: 'Archivierte Notizen bleiben erhalten und koennen jederzeit wiederhergestellt werden.',
      color: '#e8eaed',
      isPinned: false,
      isArchived: true,
      tags: ['archiv'],
      images: [],
      isTodoList: false,
      todoItems: [],
      linkPreviews: [],
      userId,
      sharedWith: [],
      createdAt: createdAt(10),
      updatedAt: createdAt(10)
    }
  ];
}

function generateInternalPassword() {
  // The password is never printed or exposed. Public entry uses /api/auth/demo.
  return `${crypto.randomBytes(48).toString('base64url')}Aa1`;
}

async function inspectDemoDatabase(config) {
  const users = await User.find({}).select('+isBootstrapAdmin +sessionVersion');
  const unexpectedUser = users.find(user => !user.isDemo);
  if (unexpectedUser) {
    throw new Error('Demo reset refused: the database contains a non-demo user');
  }
  if (users.length > 1) {
    throw new Error('Demo reset refused: the database contains multiple demo users');
  }

  const user = users[0] || null;
  if (user && (
    user.username !== config.username ||
    user.email !== config.email ||
    user.provider !== 'local' ||
    user.providerId !== null ||
    user.isAdmin ||
    user.isBootstrapAdmin
  )) {
    throw new Error('Demo reset refused: the demo account identity or role is unexpected');
  }

  const unexpectedNotes = user
    ? await Note.countDocuments({ userId: { $ne: user._id } })
    : await Note.countDocuments({});
  const unexpectedApiKeys = user
    ? await ApiKey.countDocuments({ userId: { $ne: user._id } })
    : await ApiKey.countDocuments({});

  if (unexpectedNotes || unexpectedApiKeys) {
    throw new Error('Demo reset refused: the database contains data outside the demo account');
  }

  return user;
}

async function createDemoUser(config) {
  const user = new User({
    username: config.username,
    email: config.email,
    password: generateInternalPassword(),
    provider: 'local',
    isAdmin: false,
    isDemo: true,
    isBootstrapAdmin: false,
    friends: [],
    friendRequests: []
  });
  await user.save();
  return user;
}

async function resetDemoData(config = getDemoConfig(), referenceTime = new Date()) {
  let user = await inspectDemoDatabase(config);
  if (!user) user = await createDemoUser(config);

  await User.updateOne(
    { _id: user._id, isDemo: true },
    {
      $set: {
        isAdmin: false,
        isBootstrapAdmin: false,
        friends: [],
        friendRequests: []
      },
      $inc: { sessionVersion: 1 }
    }
  );

  await Promise.all([
    ApiKey.deleteMany({ userId: user._id }),
    Settings.updateOne(
      { _id: '1' },
      { $set: { registrationEnabled: false, updatedAt: new Date(referenceTime) } },
      { upsert: true }
    )
  ]);

  await Note.deleteMany({ userId: user._id });
  const fixtures = buildDemoFixtures(user._id, referenceTime);
  await Note.insertMany(fixtures, { ordered: true });

  return { userId: user._id, noteCount: fixtures.length };
}

async function connectWithRetry(maxAttempts = 30, delayMs = 2000) {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required for the demo reset worker');
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}

async function main() {
  if (!isDemoMode()) {
    console.log('Demo reset worker disabled');
    return;
  }

  const config = getDemoConfig();
  await connectWithRetry();
  await Promise.all([User.init(), Note.init(), ApiKey.init(), Settings.init()]);

  while (true) {
    const result = await resetDemoData(config);
    console.log(`Demo data reset complete (${result.noteCount} fixture notes)`);
    await new Promise(resolve => setTimeout(
      resolve,
      config.resetIntervalHours * 60 * 60 * 1000
    ));
  }
}

if (require.main === module) {
  const disconnectAndExit = async () => {
    await mongoose.disconnect().catch(() => {});
    process.exit(0);
  };
  process.once('SIGTERM', disconnectAndExit);
  process.once('SIGINT', disconnectAndExit);

  main().catch(async error => {
    console.error('Demo reset worker failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = {
  DEMO_NOTE_IDS,
  buildDemoFixtures,
  getDemoConfig,
  inspectDemoDatabase,
  parseResetIntervalHours,
  resetDemoData
};
