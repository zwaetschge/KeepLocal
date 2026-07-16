const https = require('https');
const http = require('http');
const { URL } = require('url');
const dns = require('dns').promises;
const net = require('net');

const MAX_REDIRECTS = 3;
const MAX_RESPONSE_BYTES = 100000;

const createValidationError = (message) => {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
};

const normalizeIp = (ip) => String(ip).replace(/^\[|\]$/g, '').toLowerCase();

const mappedIpv4 = (ip) => {
  const dotted = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (dotted) return dotted[1];

  const hexadecimal = ip.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i);
  if (!hexadecimal) return null;
  const value = (parseInt(hexadecimal[1], 16) * 65536) + parseInt(hexadecimal[2], 16);
  return [value >>> 24, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join('.');
};

const isBlockedIp = (rawIp) => {
  const ip = normalizeIp(rawIp);
  const type = net.isIP(ip);
  if (type === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b, c] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) return true;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }

  if (type === 6) {
    const mapped = mappedIpv4(ip);
    if (mapped) return isBlockedIp(mapped);
    if (ip === '::' || ip === '::1' || ip.startsWith('2001:db8:')) return true;

    // Public IPv6 unicast is 2000::/3. Reject all special-purpose ranges.
    const firstGroup = parseInt(ip.split(':')[0], 16);
    return !Number.isInteger(firstGroup) || firstGroup < 0x2000 || firstGroup > 0x3fff;
  }

  return true;
};

async function validateUrlSafety(parsedUrl) {
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw createValidationError('Nur HTTP/HTTPS URLs sind erlaubt');
  }

  if (!parsedUrl.hostname) {
    throw createValidationError('Ungültige URL');
  }

  if (parsedUrl.username || parsedUrl.password) {
    throw createValidationError('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt');
  }

  const hostname = normalizeIp(parsedUrl.hostname);
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw createValidationError('Lokale Adressen sind nicht erlaubt');
  }

  const hostIsIp = net.isIP(hostname);
  if (hostIsIp) {
    if (isBlockedIp(hostname)) {
      throw createValidationError('Private IP-Adressen sind nicht erlaubt');
    }
    return { address: hostname, family: hostIsIp };
  }

  try {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!addresses.length) {
      throw createValidationError('Host konnte nicht aufgelöst werden');
    }

    if (addresses.some(addr => isBlockedIp(addr.address))) {
      throw createValidationError('Private IP-Adressen sind nicht erlaubt');
    }
    return addresses[0];
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
    if (typeof url !== 'string' || url.length > 2048) {
      throw createValidationError('URL ist ungueltig oder zu lang');
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (_) {
      throw createValidationError('Ungueltige URL');
    }
    const resolvedAddress = await validateUrlSafety(parsedUrl);

    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      method: 'GET',
      timeout: 5000,
      lookup: (hostname, options, callback) => {
        const done = typeof options === 'function' ? options : callback;
        const lookupOptions = typeof options === 'object' ? options : {};
        if (lookupOptions.all) {
          return done(null, [resolvedAddress]);
        }
        return done(null, resolvedAddress.address, resolvedAddress.family);
      },
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
            response.resume();
            return reject(createValidationError('Zu viele Weiterleitungen'));
          }

          try {
            const redirectUrl = new URL(response.headers.location, parsedUrl);
            response.resume();
            return fetchLinkPreview(redirectUrl.toString(), redirectCount + 1)
              .then(resolve)
              .catch(reject);
          } catch (redirectError) {
            return reject(createValidationError('Ungültige Weiterleitungs-URL'));
          }
        }

        if (response.statusCode !== 200) {
          response.resume();
          return reject(new Error(`HTTP ${response.statusCode}`));
        }

        const contentType = response.headers['content-type'] || '';
        if (contentType && !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
          response.resume();
          return reject(createValidationError('URL liefert kein HTML-Dokument'));
        }

        let html = '';
        let receivedBytes = 0;
        let completed = false;
        response.setEncoding('utf8');

        response.on('data', (chunk) => {
          receivedBytes += Buffer.byteLength(chunk, 'utf8');
          if (receivedBytes > MAX_RESPONSE_BYTES) {
            completed = true;
            response.destroy();
            reject(createValidationError('HTML-Antwort ist zu gross'));
            return;
          }
          html += chunk;
        });

        response.on('end', () => {
          if (completed) return;
          completed = true;
          try {
            const metadata = parseOpenGraphTags(html, parsedUrl.toString());
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
    try {
      const parsedUrl = new URL(url);
      const imageUrl = new URL(metadata.image, parsedUrl);
      metadata.image = ['http:', 'https:'].includes(imageUrl.protocol) ? imageUrl.href : '';
    } catch (_) {
      metadata.image = '';
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

  metadata.title = metadata.title.slice(0, 200);
  metadata.description = metadata.description.slice(0, 500);
  metadata.siteName = metadata.siteName.slice(0, 100);
  metadata.image = metadata.image.slice(0, 2048);

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

module.exports = {
  fetchLinkPreview,
  isBlockedIp,
  validateUrlSafety,
  parseOpenGraphTags
};
