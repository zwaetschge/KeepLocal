const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { authenticateToken } = require('../middleware/auth');

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
    const pendingRequests = user.friendRequests.filter(req => req.status === 'pending');

    res.json(pendingRequests);
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/request - Freundschaftsanfrage senden
router.post('/request', async (req, res, next) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Benutzername ist erforderlich' });
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
    if (targetUser.friends.includes(req.user._id)) {
      return res.status(400).json({ error: 'Bereits Freunde' });
    }

    // Prüfen ob bereits eine Anfrage existiert
    const existingRequest = targetUser.friendRequests.find(
      req => req.from.toString() === req.user._id.toString() && req.status === 'pending'
    );

    if (existingRequest) {
      return res.status(400).json({ error: 'Anfrage bereits gesendet' });
    }

    // Anfrage hinzufügen
    targetUser.friendRequests.push({
      from: req.user._id,
      status: 'pending'
    });

    await targetUser.save();

    res.json({ message: 'Freundschaftsanfrage gesendet' });
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/accept/:requestId - Freundschaftsanfrage akzeptieren
router.post('/accept/:requestId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    // Anfrage finden
    const request = user.friendRequests.id(req.params.requestId);
    if (!request) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    // Anfrage akzeptieren
    request.status = 'accepted';

    // Beide Benutzer als Freunde hinzufügen
    user.friends.push(request.from);
    await user.save();

    const requester = await User.findById(request.from);
    requester.friends.push(user._id);
    await requester.save();

    res.json({ message: 'Freundschaftsanfrage akzeptiert' });
  } catch (error) {
    next(error);
  }
});

// POST /api/friends/reject/:requestId - Freundschaftsanfrage ablehnen
router.post('/reject/:requestId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);

    // Anfrage finden
    const request = user.friendRequests.id(req.params.requestId);
    if (!request) {
      return res.status(404).json({ error: 'Anfrage nicht gefunden' });
    }

    if (request.status !== 'pending') {
      return res.status(400).json({ error: 'Anfrage wurde bereits bearbeitet' });
    }

    // Anfrage ablehnen (entfernen)
    request.remove();
    await user.save();

    res.json({ message: 'Freundschaftsanfrage abgelehnt' });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/friends/:friendId - Freund entfernen
router.delete('/:friendId', async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id);
    const friend = await User.findById(req.params.friendId);

    if (!friend) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Freund aus beiden Listen entfernen
    user.friends = user.friends.filter(id => id.toString() !== friend._id.toString());
    friend.friends = friend.friends.filter(id => id.toString() !== user._id.toString());

    await user.save();
    await friend.save();

    res.json({ message: 'Freund entfernt' });
  } catch (error) {
    next(error);
  }
});

// GET /api/friends/search - Benutzer suchen (für Admin)
router.get('/search', async (req, res, next) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === '') {
      return res.json([]);
    }

    // Admin kann alle Benutzer suchen, normale Benutzer nur Freunde
    let users;
    if (req.user.isAdmin) {
      users = await User.find({
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } }
        ],
        _id: { $ne: req.user._id } // Nicht sich selbst
      }).select('username email').limit(10);
    } else {
      users = await User.find({
        _id: { $in: req.user.friends, $ne: req.user._id },
        $or: [
          { username: { $regex: query, $options: 'i' } },
          { email: { $regex: query, $options: 'i' } }
        ]
      }).select('username email').limit(10);
    }

    res.json(users);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
