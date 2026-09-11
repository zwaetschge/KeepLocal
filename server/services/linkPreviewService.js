const crypto = require('crypto');

const LinkPreviewCache = require('../models/LinkPreviewCache');
const { fetchLinkPreview } = require('../utils/linkPreview');

/**
 * Link previews with a 15-minute cache (see models/LinkPreviewCache.js).
 *
 * Only successful previews are cached: a dead link should not be remembered, and
 * its error is cheap enough (one upstream answer) to surface every time. Cache
 * problems never fail the request — the preview is simply fetched again.
 */

const hashUrl = (url) => crypto.createHash('sha256').update(String(url)).digest('hex');

/**
 * @param {string} url
 * @returns {Promise<{preview: Object, cached: boolean}>}
 * @throws Whatever fetchLinkPreview throws (validation error with statusCode 400
 *   or an upstream failure with 502).
 */
async function getLinkPreview(url) {
  const urlHash = hashUrl(url);

  try {
    const cached = await LinkPreviewCache.findOne({ urlHash }).lean();
    if (cached && cached.payload) {
      return { preview: cached.payload, cached: true };
    }
  } catch (error) {
    console.warn('[link-preview-cache] read failed, fetching directly:', error.message);
  }

  const preview = await fetchLinkPreview(url);

  try {
    await LinkPreviewCache.updateOne(
      { urlHash },
      { $set: { url, payload: preview, createdAt: new Date() } },
      { upsert: true }
    );
  } catch (error) {
    console.warn('[link-preview-cache] write failed (preview is still served):', error.message);
  }

  return { preview, cached: false };
}

module.exports = { getLinkPreview, hashUrl };
