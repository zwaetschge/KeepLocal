const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');
const { escapeRegex } = require('../utils/sanitize');

// Alle Routen erfordern Authentifizierung
router.use(authenticateToken);

// GET /api/friends - Alle Freunde abrufen
router.get('/', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friends', 'username email')
      .select('friends');

    res.json(user.friends || []);
  } catch (error) {
    next(error);
  }
});

// GET /api/friends/requests - Alle Freundschaftsanfragen abrufen
router.get('/requests', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('friendRequests.from', 'username email')
      .select('friendRequests');

    // Nur pending requests zurückgeben
    const pendingRequests = user.friendRequests.filter(fr => fr.status === 'pending');

    res.json(pendingRequests);
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/request - Freundschaftsanfrage senden
router.post('/request', async (req, res, next) => {
  try {
    const { username } = req.body;

    if (
      typeof username !== 'string' ||
      username.length < 3 ||
      username.length > 50 ||
      !/^[a-zA-Z0-9_-]+$/.test(username)
    ) {
      return res.status(400).json({ error: 'Ungueltiger Benutzername' });
    }

    // Ziel-Benutzer finden
    const targetUser = await User.findOne({ username });
    if (!targetUser) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Nicht sich selbst hinzufügen
    if (targetUser._id.toString() === req.user._id.toString()) {
      return res.status(400).json({ error: 'Du kannst dich nicht selbst als Freund hinzufügen' });
    }

    // Prüfen ob bereits Freunde
    if (targetUser.friends.some(friendId => friendId.toString() === req.user._id.toString())) {
      return res.status(400).json({ error: 'Bereits Freunde' });
    }

    const reverseRequest = req.user.friendRequests?.some(
      fr => fr.from.toString() === targetUser._id.toString() && fr.status === 'pending'
    );
    if (reverseRequest) {
      return res.status(409).json({ error: 'Von diesem Benutzer liegt bereits eine Anfrage vor' });
    }

    // Prüfen ob bereits eine Anfrage existiert
    const existingRequest = targetUser.friendRequests.find(
      fr => fr.from.toString() === req.user._id.toString() && fr.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({ error: 'Anfrage bereits gesendet' });
    }

    // Anfrage hinzufügen
    const result = await User.updateOne(
      {
        _id: targetUser._id,
        friends: { $ne: req.user._id },
        friendRequests: {
          $not: { $elemMatch: { from: req.user._id, status: 'pending' } }
        }
      },
      {
        $push: { friendRequests: { from: req.user._id, status: 'pending' } }
      }
    );

    if (result.modifiedCount !== 1) {
      return res.status(409).json({ error: 'Anfrage bereits gesendet oder bereits befreundet' });
    }

    res.json({ message: 'Freundschaftsanfrage gesendet' });
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/accept/:requestId - Freundschaftsanfrage akzeptieren
router.post('/accept/:requestId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.requestId)) {
      return res.status(400).json({ error: 'Ungueltige Anfrage-ID' });
    }

    const user = await User.findById(req.user._id);

    // Anfrage finden
    const request = user.friendRequests.id(req.params.requestId);
    if (!request) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    const requester = await User.findById(request.from);
    if (!requester) {
      user.friendRequests.pull(request._id);
      await user.save();
      return res.status(404).json({ error: 'Anfragender Benutzer existiert nicht mehr' });
    }

    // Update the requester first. If the second write fails, the pending
    // request remains and accepting it again safely completes the operation.
    await User.updateOne(
      { _id: requester._id },
      { $addToSet: { friends: user._id } }
    );

    const accepted = await User.findOneAndUpdate(
      {
        _id: user._id,
        friendRequests: { $elemMatch: { _id: request._id, status: 'pending' } }
      },
      {
        $addToSet: { friends: requester._id },
        $pull: { friendRequests: { _id: request._id } }
      }
    );

    if (!accepted) {
      return res.status(409).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    res.json({ message: 'Freundschaftsanfrage akzeptiert' });
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/reject/:requestId - Freundschaftsanfrage ablehnen
router.post('/reject/:requestId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.requestId)) {
      return res.status(400).json({ error: 'Ungueltige Anfrage-ID' });
    }

    const user = await User.findOneAndUpdate(
      {
        _id: req.user._id,
        friendRequests: { $elemMatch: { _id: req.params.requestId, status: 'pending' } }
      },
      { $pull: { friendRequests: { _id: req.params.requestId } } }
    );

    if (!user) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    res.json({ message: 'Freundschaftsanfrage abgelehnt' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/friends/:friendId - Freund entfernen
router.delete('/:friendId', async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.friendId)) {
      return res.status(400).json({ error: 'Ungueltige Benutzer-ID' });
    }

    const friend = await User.findById(req.params.friendId);

    if (!friend) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Both updates are idempotent, so a transient failure can be retried.
    await User.updateOne(
      { _id: friend._id },
      { $pull: { friends: req.user._id } }
    );
    await User.updateOne(
      { _id: req.user._id },
      { $pull: { friends: friend._id } }
    );

    res.json({ message: 'Freund entfernt' });
  } catch (error) {
    next(error);
  }
});

// GET /api/friends/search - Benutzer suchen
router.get('/search', async (req, res, next) => {
  try {
    const { query } = req.query;
    const trimmedQuery = (query || '').trim();
    if (trimmedQuery.length > 100) {
      return res.status(400).json({ error: 'Suchbegriff darf maximal 100 Zeichen lang sein' });
    }
    const safeQuery = escapeRegex(trimmedQuery);

    if (!safeQuery) {
      return res.json([]);
    }

    const regexQuery = { $regex: safeQuery, $options: 'i' };

    const searchFields = req.user.isAdmin
      ? [{ username: regexQuery }, { email: regexQuery }]
      : [{ username: regexQuery }];
    const users = await User.find({
      $or: searchFields,
      _id: { $ne: req.user._id }
    })
      .select(req.user.isAdmin ? 'username email' : 'username')
      .limit(10);

    res.json(users);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
