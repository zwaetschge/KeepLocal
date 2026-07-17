const Note = require('../models/Note');

const DEMO_FEATURE_ERROR = 'Diese Funktion ist in der oeffentlichen Demo deaktiviert.';
const DEFAULT_DEMO_NOTE_LIMIT = 100;
const MAX_DEMO_NOTE_LIMIT = 500;
let demoNoteCreationQueue = Promise.resolve();

function isDemoMode(environment = process.env) {
  return environment.DEMO_MODE === 'true';
}

function parseDemoNoteLimit(value = process.env.DEMO_NOTE_LIMIT) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return DEFAULT_DEMO_NOTE_LIMIT;
  }
  return Math.min(parsed, MAX_DEMO_NOTE_LIMIT);
}

function demoFeatureDisabled(res, feature) {
  return res.status(403).json({
    error: DEMO_FEATURE_ERROR,
    code: 'DEMO_FEATURE_DISABLED',
    feature
  });
}

function blockDemoUser(feature) {
  return (req, res, next) => {
    if (!req.user?.isDemo) return next();
    return demoFeatureDisabled(res, feature);
  };
}

function rejectDemoNoteCapabilities(req, res, next) {
  if (!req.user?.isDemo) return next();

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const hasLinkPreviews = Array.isArray(body.linkPreviews) && body.linkPreviews.length > 0;
  const hasRestrictedData = hasLinkPreviews ||
    Object.prototype.hasOwnProperty.call(body, 'images') ||
    Object.prototype.hasOwnProperty.call(body, 'sharedWith');

  if (hasRestrictedData) {
    return demoFeatureDisabled(res, 'note_attachments');
  }
  return next();
}

function createDemoNoteLimitMiddleware(countDocuments = (query) => Note.countDocuments(query)) {
  return async (req, res, next) => {
    if (!req.user?.isDemo) return next();

    let releaseQueue;
    const previousRequest = demoNoteCreationQueue;
    demoNoteCreationQueue = new Promise(resolve => {
      releaseQueue = resolve;
    });
    await previousRequest;

    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      releaseQueue();
    };

    try {
      const noteCount = await countDocuments({ userId: req.user._id });
      const limit = parseDemoNoteLimit();
      if (noteCount >= limit) {
        release();
        return res.status(429).json({
          error: `Die oeffentliche Demo ist auf ${limit} Notizen begrenzt.`,
          code: 'DEMO_NOTE_LIMIT'
        });
      }

      // The all-in-one demo has one Node process. Holding this small queue
      // until the response finishes keeps parallel creates from all observing
      // the same pre-insert count and bursting past the quota.
      if (typeof res.once === 'function') {
        res.once('finish', release);
        res.once('close', release);
      } else {
        release();
      }
      return next();
    } catch (error) {
      release();
      return next(error);
    }
  };
}

const enforceDemoNoteLimit = createDemoNoteLimitMiddleware();

function shouldRevokeAllSessionsOnLogout(user) {
  return Boolean(user && !user.isDemo);
}

module.exports = {
  DEFAULT_DEMO_NOTE_LIMIT,
  DEMO_FEATURE_ERROR,
  blockDemoUser,
  createDemoNoteLimitMiddleware,
  enforceDemoNoteLimit,
  isDemoMode,
  parseDemoNoteLimit,
  rejectDemoNoteCapabilities,
  shouldRevokeAllSessionsOnLogout
};
