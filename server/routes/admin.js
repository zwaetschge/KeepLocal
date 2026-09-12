const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const User = require('../models/User');
const Note = require('../models/Note');
const Settings = require('../models/Settings');
const { authenticateToken } = require('../middleware/auth');
const adminService = require('../services/adminService');
const normalizeEmailAddress = require('../utils/normalizeEmail');
const { escapeRegex } = require('../utils/sanitize');
const { createPasswordResetToken } = require('../utils/passwordReset');

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Zugriff verweigert. Admin-Rechte erforderlich.' });
  }
  next();
};

// Apply authentication to all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// GET /api/admin/users - Get all users
router.get('/users', async (req, res) => {
  try {
    const users = await User.find()
      .select('-password')
      .sort({ createdAt: -1 });

    res.json({ users });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Benutzer' });
  }
});

// POST /api/admin/users - Create a new user
router.post('/users', async (req, res) => {
  try {
    const { username, email, password, isAdmin } = req.body;
    const isAdminFlag = isAdmin === true || isAdmin === 'true';
    const normalizedEmail = normalizeEmailAddress(email);
    const normalizedUsername = username?.trim();

    // Validation
    if (!normalizedUsername || !normalizedEmail || typeof password !== 'string') {
      return res.status(400).json({ error: 'Benutzername, E-Mail und Passwort sind erforderlich' });
    }

    if (normalizedUsername.length < 3 || normalizedUsername.length > 50) {
      return res.status(400).json({ error: 'Benutzername muss zwischen 3 und 50 Zeichen lang sein' });
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(normalizedUsername)) {
      return res.status(400).json({
        error: 'Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten'
      });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    }

    if (password.length < 8 || password.length > 128) {
      return res.status(400).json({ error: 'Passwort muss zwischen 8 und 128 Zeichen lang sein' });
    }

    if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
      return res.status(400).json({
        error: 'Passwort muss mindestens einen Kleinbuchstaben, einen Großbuchstaben und eine Zahl enthalten'
      });
    }

    // Check if user already exists. Usernames are stored case-sensitively but
    // searched case-insensitively (friend search), so "DAVE" next to "dave"
    // would produce two interchangeable identities and has to be rejected.
    const existingUser = await User.findOne({
      $or: [
        { email: normalizedEmail },
        { username: normalizedUsername },
        { username: { $regex: new RegExp(`^${escapeRegex(normalizedUsername)}$`, 'i') } }
      ]
    });
    if (existingUser) {
      if (existingUser.email === normalizedEmail) {
        return res.status(400).json({ error: 'E-Mail-Adresse bereits vergeben' });
      }
      return res.status(400).json({ error: 'Benutzername bereits vergeben' });
    }

    // Create user
    const user = new User({
      username: normalizedUsername,
      email: normalizedEmail,
      password, // Will be hashed by the User model pre-save hook
      isAdmin: isAdminFlag
    });

    await user.save();

    res.status(201).json({
      message: 'Benutzer erfolgreich erstellt',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    if (error.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0];
      const fieldName = duplicateField === 'email' ? 'E-Mail-Adresse' : 'Benutzername';
      return res.status(409).json({ error: `${fieldName} bereits vergeben` });
    }
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
  }
});

// GET /api/admin/stats - Get system statistics
router.get('/stats', async (req, res) => {
  try {
    const [userCount, noteCount, trashCount, recentUsers] = await Promise.all([
      User.countDocuments(),
      // Papierkorb-Notizen sind in keiner Listenansicht sichtbar — sie hier
      // mitzuzählen ließ die Admin-Statistik über der echten Notizzahl liegen.
      Note.countDocuments({ deletedAt: null }),
      Note.countDocuments({ deletedAt: { $ne: null } }),
      User.find()
        .select('-password')
        .sort({ createdAt: -1 })
        .limit(5)
    ]);

    // Get notes per user
    const notesPerUser = await Note.aggregate([
      { $match: { deletedAt: null } },
      {
        $group: {
          _id: '$userId',
          count: { $sum: 1 }
        }
      },
      {
        $lookup: {
          from: 'users',
          localField: '_id',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: '$user'
      },
      {
        $project: {
          username: '$user.username',
          email: '$user.email',
          noteCount: '$count'
        }
      },
      {
        $sort: { noteCount: -1 }
      },
      {
        $limit: 10
      }
    ]);

    res.json({
      stats: {
        totalUsers: userCount,
        totalNotes: noteCount,
        trashNotes: trashCount,
        recentUsers,
        topUsers: notesPerUser
      }
    });
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Statistiken' });
  }
});

// DELETE /api/admin/users/:id - Delete a user (and all their notes)
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
    }

    // Prevent admin from deleting themselves
    if (id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Sie können sich nicht selbst löschen' });
    }

    const user = await adminService.deleteUser(id, req.user._id.toString());

    res.json({
      message: 'Benutzer und alle zugehörigen Notizen wurden gelöscht',
      deletedUser: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Benutzers' });
  }
});

// PATCH /api/admin/users/:id/admin - Toggle admin status
router.patch('/users/:id/admin', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
    }

    // Guard lives in the service, so this route and the delete route cannot
    // drift apart: no self-modification, and the last admin keeps their rights
    // (without an admin there is no way back — password reset tokens are
    // admin-only and there is no SMTP path).
    const user = await adminService.toggleUserAdmin(id, req.user._id.toString());

    res.json({
      message: user.isAdmin ? 'Benutzer wurde zum Admin ernannt' : 'Admin-Rechte wurden entzogen',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin
      }
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    console.error('Error updating user admin status:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Admin-Status' });
  }
});

// GET /api/admin/settings - Get system settings
router.get('/settings', async (req, res) => {
  try {
    let settings = await Settings.findById('1');

    // Create default settings if they don't exist
    if (!settings) {
      settings = new Settings({ _id: '1', registrationEnabled: false });
      await settings.save();
    }

    res.json({
      settings: {
        registrationEnabled: settings.registrationEnabled,
        updatedAt: settings.updatedAt
      }
    });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Fehler beim Laden der Einstellungen' });
  }
});

// PATCH /api/admin/settings - Update system settings
router.patch('/settings', async (req, res) => {
  try {
    const { registrationEnabled } = req.body;

    if (typeof registrationEnabled !== 'boolean') {
      return res.status(400).json({ error: 'registrationEnabled muss ein Boolean sein' });
    }

    let settings = await Settings.findById('1');

    // Create default settings if they don't exist
    if (!settings) {
      settings = new Settings({ _id: '1' });
    }

    // Update settings
    settings.registrationEnabled = registrationEnabled;

    await settings.save();

    res.json({
      message: 'Einstellungen erfolgreich aktualisiert',
      settings: {
        registrationEnabled: settings.registrationEnabled,
        updatedAt: settings.updatedAt
      }
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren der Einstellungen' });
  }
});

// POST /api/admin/users/:id/password-reset - Einmal-Token für einen Nutzer
// erzeugen. Self-Hosting hat keinen Mail-Versand, daher zeigt die Admin-Konsole
// das Token einmal an und die Admins übergeben es auf ihrem Weg. Gespeichert
// wird nur der Hash; das Token ist 15 Minuten gültig und wird beim Einlösen
// gelöscht (alle Sitzungen des Kontos verlieren ihre Gültigkeit).
router.post('/users/:id/password-reset', async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
    }
    if (id === req.user._id.toString()) {
      return res.status(400).json({
        error: 'Für das eigene Konto bitte "Passwort ändern" in den Einstellungen verwenden'
      });
    }

    const { token, tokenHash, expiresAt } = createPasswordResetToken();
    const user = await User.findOneAndUpdate(
      { _id: id, isDemo: { $ne: true } },
      { passwordResetToken: tokenHash, passwordResetExpires: expiresAt },
      { new: true }
    ).select('username email');

    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    console.warn(`[admin] password reset token issued for user ${user._id} by ${req.user._id}`);

    res.json({
      message: 'Reset-Token erstellt. Es wird nur einmal angezeigt und ist 15 Minuten gültig.',
      resetToken: token,
      expiresAt,
      user: { id: user._id, username: user.username, email: user.email }
    });
  } catch (error) {
    console.error('Error creating password reset token:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Reset-Tokens' });
  }
});

module.exports = router;
