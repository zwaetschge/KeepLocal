const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: [true, 'Benutzername ist erforderlich'],
    unique: true,
    trim: true,
    minlength: [3, 'Benutzername muss mindestens 3 Zeichen lang sein'],
    maxlength: [50, 'Benutzername darf maximal 50 Zeichen lang sein'],
    match: [/^[a-zA-Z0-9_-]+$/, 'Benutzername darf nur Buchstaben, Zahlen, Bindestriche und Unterstriche enthalten']
  },
  email: {
    type: String,
    required: [true, 'E-Mail ist erforderlich'],
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^\S+@\S+\.\S+$/, 'Ungültige E-Mail-Adresse']
  },
  password: {
    type: String,
    required: function() {
      return this.provider === 'local';
    },
    minlength: [8, 'Passwort muss mindestens 8 Zeichen lang sein']
  },
  provider: {
    type: String,
    enum: ['local', 'google', 'github'],
    default: 'local'
  },
  providerId: {
    type: String,
    default: null
  },
  avatar: {
    type: String,
    default: null
  },
  isAdmin: {
    type: Boolean,
    default: false
  },
  isDemo: {
    type: Boolean,
    default: false
  },
  isBootstrapAdmin: {
    type: Boolean,
    default: false,
    select: false
  },
  sessionVersion: {
    type: Number,
    default: 0,
    min: 0,
    select: false
  },
  // One-time password reset (admin-generated token, SHA-256 hash stored, 15 min
  // TTL). Never selected by default and never serialized.
  passwordResetToken: {
    type: String,
    default: null,
    select: false
  },
  passwordResetExpires: {
    type: Date,
    default: null,
    select: false
  },
  // Konto-weite Voreinstellungen. Früher lagen Theme, Sprache und AI-Flags nur
  // im localStorage des Geräts: neues Gerät = Defaults, und am gemeinsamen
  // Rechner erbte der nächste Nutzer die Einstellungen des vorigen.
  preferences: {
    theme: {
      type: String,
      enum: ['light', 'dark', 'oled', 'eink', 'doodle'],
      default: 'light'
    },
    // null = Browsersprache verwenden (kein expliziter Wunsch gespeichert)
    language: {
      type: String,
      enum: ['de', 'en', null],
      default: null
    },
    aiFeatures: {
      voiceTranscription: {
        type: Boolean,
        default: false
      }
    },
    transcriptionLanguage: {
      type: String,
      default: 'auto',
      maxlength: 20
    },
    // Markdown-Rendering der Karten (v1.13.0): Die meisten Bestandsnotizen
    // (Trilium-Import) sind Markdown — default an, abschaltbar fuer Konten,
    // die rohen Text bevorzugen.
    renderMarkdown: {
      type: Boolean,
      default: true
    },
    // Tag-Farben (v1.10.0): Map tagName -> Hex aus der Karten-Palette. Mixed,
    // weil der Schluessel ein freier Tag-Name ist; die Route validiert beide
    // Seiten und kappt die Menge.
    tagColors: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    // Gespeicherte Suchen (v1.10.0): als smarte Ordner im Baum-Panel. Liegen im
    // Konto statt im Geraet, damit sie ueberall gleich sind.
    savedSearches: [{
      id: {
        type: String,
        required: true,
        maxlength: 40
      },
      name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 50
      },
      query: {
        type: String,
        default: '',
        maxlength: 200
      },
      typeFilter: {
        type: String,
        enum: ['all', 'lists', 'text', 'images', 'reminders', 'pinned'],
        default: 'all'
      },
      tag: {
        type: String,
        default: '',
        maxlength: 50
      }
    }],
    // Journal (v1.10.0): Wurzel-Knoten der Tages-Notizen. null = Journal noch
    // nie benutzt; der Client legt den Ordner beim ersten „Heute" an.
    journalFolderId: {
      type: String,
      default: null,
      maxlength: 24
    }
  },
  friends: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }],
  friendRequests: [{
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'rejected'],
      default: 'pending'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, {
  timestamps: true
});

// OAuth identities must be unique when a provider ID exists. The partial
// index avoids treating all local users (providerId=null) as duplicates.
userSchema.index(
  { provider: 1, providerId: 1 },
  { unique: true, partialFilterExpression: { providerId: { $type: 'string' } } }
);

// Exactly one account can win the first-user race. Other admins are unaffected.
userSchema.index(
  { isBootstrapAdmin: 1 },
  {
    name: 'single_bootstrap_admin',
    unique: true,
    partialFilterExpression: { isBootstrapAdmin: true }
  }
);

// Public demo deployments use exactly one deliberately restricted account.
// The partial index leaves all normal users unaffected.
userSchema.index(
  { isDemo: 1 },
  {
    name: 'single_demo_user',
    unique: true,
    partialFilterExpression: { isDemo: true }
  }
);

// Passwort vor dem Speichern hashen
userSchema.pre('save', async function(next) {
  // Skip hashing for OAuth users without a password
  if (!this.password || !this.isModified('password')) {
    return next();
  }

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Methode zum Passwort-Vergleich
userSchema.methods.comparePassword = async function(candidatePassword) {
  if (!this.password) return false;
  return await bcrypt.compare(candidatePassword, this.password);
};

// Passwort nicht in JSON aufnehmen
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.sessionVersion;
  delete obj.isBootstrapAdmin;
  delete obj.passwordResetToken;
  delete obj.passwordResetExpires;
  return obj;
};

const User = mongoose.model('User', userSchema);

module.exports = User;
