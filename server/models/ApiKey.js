const mongoose = require('mongoose');
const crypto = require('crypto');

const apiKeySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'API-Key Name ist erforderlich'],
    trim: true,
    maxlength: 100
  },
  key: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  prefix: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  lastUsedAt: {
    type: Date,
    default: null
  },
  expiresAt: {
    type: Date,
    default: null // null = never expires
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

/**
 * Generate a new API key
 * Returns the raw key (only shown once) and the hashed version for storage
 */
apiKeySchema.statics.generateKey = function () {
  const rawKey = `kl_${crypto.randomBytes(32).toString('hex')}`;
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  const prefix = rawKey.substring(0, 7);
  return { rawKey, hash, prefix };
};

/**
 * Find API key by raw key value
 */
apiKeySchema.statics.findByKey = async function (rawKey) {
  const hash = crypto.createHash('sha256').update(rawKey).digest('hex');
  return this.findOne({ key: hash, isActive: true });
};

const ApiKey = mongoose.model('ApiKey', apiKeySchema);

module.exports = ApiKey;
