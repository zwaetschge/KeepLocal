const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Note = require('../models/Note');
const { authenticateToken } = require('../middleware/auth');

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

    // Validation
    if (!username || !email || !password) {
      return res.status(400).json({ error: 'Benutzername, E-Mail und Passwort sind erforderlich' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Passwort muss mindestens 6 Zeichen lang sein' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { username }] });
    if (existingUser) {
      if (existingUser.email === email) {
        return res.status(400).json({ error: 'E-Mail-Adresse bereits vergeben' });
      }
      return res.status(400).json({ error: 'Benutzername bereits vergeben' });
    }

    // Create user
    const user = new User({
      username,
      email,
      password, // Will be hashed by the User model pre-save hook
      isAdmin: isAdmin || false
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
    console.error('Error creating user:', error);
    res.status(500).json({ error: 'Fehler beim Erstellen des Benutzers' });
  }
});

// GET /api/admin/stats - Get system statistics
router.get('/stats', async (req, res) => {
  try {
    const [userCount, noteCount, recentUsers] = await Promise.all([
      User.countDocuments(),
      Note.countDocuments(),
      User.find()
        .select('-password')
        .sort({ createdAt: -1 })
        .limit(5)
    ]);

    // Get notes per user
    const notesPerUser = await Note.aggregate([
      {
        $group: {
          _id: '$user',
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

    // Prevent admin from deleting themselves
    if (id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Sie können sich nicht selbst löschen' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    // Delete all notes belonging to this user
    await Note.deleteMany({ user: id });

    // Delete the user
    await User.findByIdAndDelete(id);

    res.json({
      message: 'Benutzer und alle zugehörigen Notizen wurden gelöscht',
      deletedUser: {
        id: user._id,
        username: user.username,
        email: user.email
      }
    });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Fehler beim Löschen des Benutzers' });
  }
});

// PATCH /api/admin/users/:id/admin - Toggle admin status
router.patch('/users/:id/admin', async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent admin from removing their own admin status
    if (id === req.user._id.toString()) {
      return res.status(400).json({ error: 'Sie können Ihren eigenen Admin-Status nicht ändern' });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    }

    user.isAdmin = !user.isAdmin;
    await user.save();

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
    console.error('Error updating user admin status:', error);
    res.status(500).json({ error: 'Fehler beim Aktualisieren des Admin-Status' });
  }
});

module.exports = router;
