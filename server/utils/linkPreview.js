const https = require('https');
const http = require('http');
const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 3;

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const isPrivateIp = (ip) => {
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }

  if (type === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true; // Unique local
    if (normalized.startsWith('fe80')) return true; // Link-local
    return false;
  }

  return false;
};

async function validateUrlSafety(parsedUrl) {
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createValidationError('Nur HTTP/HTTPS URLs sind erlaubt');
  }

  if (!parsedUrl.hostname) {
    throw createValidationError('Ungültige URL');
  }

  if (parsedUrl.hostname === 'localhost') {
    throw createValidationError('Lokale Adressen sind nicht erlaubt');
  }

  const hostIsIp = net.isIP(parsedUrl.hostname);
  if (hostIsIp) {
    if (isPrivateIp(parsedUrl.hostname)) {
      throw createValidationError('Private IP-Adressen sind nicht erlaubt');
    }
    return;
  }

  try {
    const addresses = await dns.lookup(parsedUrl.hostname, { all: true });
    if (!addresses.length) {
      throw createValidationError('Host konnte nicht aufgelöst werden');
    }

    if (addresses.some(addr => isPrivateIp(addr.address))) {
      throw createValidationError('Private IP-Adressen sind nicht erlaubt');
    }
  } catch (error) {
    if (error.statusCode) {
      throw error;
    }
    throw createValidationError('Host konnte nicht aufgelöst werden');
  }
}

/**
 * Fetch Open Graph metadata from a URL
 * @param {string} url - The URL to fetch metadata from
 * @returns {Promise<Object>} - Open Graph metadata
 */
async function fetchLinkPreview(url, redirectCount = 0) {
  try {
    const parsedUrl = new URL(url);
    await validateUrlSafety(parsedUrl);

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      timeout: 5000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; KeepLocalBot/1.0; +http://localhost:3000)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    };

    return await new Promise((resolve, reject) => {
      const request = protocol.get(parsedUrl, options, (response) => {
        // Handle redirects securely and with a limit
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          if (redirectCount >= MAX_REDIRECTS) {
            return reject(createValidationError('Zu viele Weiterleitungen'));
          }

          try {
            const redirectUrl = new URL(response.headers.location, parsedUrl);
            return fetchLinkPreview(redirectUrl.toString(), redirectCount + 1)
              .then(resolve)
              .catch(reject);
          } catch (redirectError) {
            return reject(createValidationError('Ungültige Weiterleitungs-URL'));
          }
        }

        if (response.statusCode !== 200) {
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        let html = '';
        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          html += chunk;
          // Stop after getting enough data for meta tags (usually in first ~50KB)
          if (html.length > 100000) {
            response.destroy();
          }
        });

        response.on('end', () => {
          try {
            const metadata = parseOpenGraphTags(html, url);
            resolve(metadata);
          } catch (error) {
            reject(error);
          }
        });

        response.on('error', reject);
      });

      request.on('error', reject);
      request.on('timeout', () => {
        request.destroy();
        reject(new Error('Request timeout'));
      });
    });
  } catch (error) {
    throw error;
  }
}

/**
 * Parse Open Graph meta tags from HTML
 * @param {string} html - HTML content
 * @param {string} url - Original URL for fallback
 * @returns {Object} - Parsed metadata
 */
function parseOpenGraphTags(html, url) {
  const metadata = {
    url: url,
    title: '',
    description: '',
    image: '',
    siteName: ''
  };

  // Extract og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:title["']/i);
  if (ogTitleMatch) {
    metadata.title = decodeHtmlEntities(ogTitleMatch[1]);
  }

  // Extract og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:description["']/i);
  if (ogDescMatch) {
    metadata.description = decodeHtmlEntities(ogDescMatch[1]);
  }

  // Extract og:image
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i) ||
                       html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:image["']/i);
  if (ogImageMatch) {
    metadata.image = ogImageMatch[1];
    // Make relative URLs absolute
    if (metadata.image && !metadata.image.startsWith('http')) {
      const parsedUrl = new URL(url);
      metadata.image = new URL(metadata.image, parsedUrl.origin).href;
    }
  }

  // Extract og:site_name
  const ogSiteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:site_name["']/i);
  if (ogSiteMatch) {
    metadata.siteName = decodeHtmlEntities(ogSiteMatch[1]);
  }

  // Fallback to regular meta tags if Open Graph tags are not present
  if (!metadata.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
    if (titleMatch) {
      metadata.title = decodeHtmlEntities(titleMatch[1]);
    }
  }

  if (!metadata.description) {
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                      html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
    if (descMatch) {
      metadata.description = decodeHtmlEntities(descMatch[1]);
    }
  }

  // Set site name from URL if not found
  if (!metadata.siteName) {
    try {
      const parsedUrl = new URL(url);
      metadata.siteName = parsedUrl.hostname;
    } catch (e) {
      // Ignore error
    }
  }

  return metadata;
}

/**
 * Decode HTML entities
 * @param {string} text - Text with HTML entities
 * @returns {string} - Decoded text
 */
function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

module.exports = { fetchLinkPreview };
