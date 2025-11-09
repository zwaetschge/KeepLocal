const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  // Singleton ID - always '1' to ensure only one settings document
  _id: {
    type: String,
    default: '1'
  },
  registrationEnabled: {
    type: Boolean,
    default: false // Registration disabled by default
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update timestamp on save
settingsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

const Settings = mongoose.model('Settings', settingsSchema);

module.exports = Settings;
