const https = require('https');
const http = require('http');
const { URL } = require('url');
const dns = require('dns').promises;

// Blocked hosts and IP ranges to prevent SSRF attacks
const BLOCKED_HOSTS = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '::',
];

// Blocked IP range patterns (private networks and link-local)
const BLOCKED_IP_PATTERNS = [
  /^10\.\d+\.\d+\.\d+$/,                    // 10.0.0.0/8
  /^172\.(1[6-9]|2[0-9]|3[0-1])\.\d+\.\d+$/, // 172.16.0.0/12
  /^192\.168\.\d+\.\d+$/,                    // 192.168.0.0/16
  /^169\.254\.\d+\.\d+$/,                    // 169.254.0.0/16 (AWS metadata)
  /^fc[0-9a-f]{2}:/i,                        // IPv6 unique local
  /^fd[0-9a-f]{2}:/i,                        // IPv6 unique local
  /^fe80:/i,                                 // IPv6 link-local
];

/**
 * Validate URL to prevent SSRF attacks
 * @param {string} url - The URL to validate
 * @throws {Error} If URL is not allowed
 */
async function validateUrl(url) {
  const parsedUrl = new URL(url);

  // Only allow HTTP and HTTPS protocols
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new Error('Only HTTP and HTTPS protocols are allowed');
  }

  const hostname = parsedUrl.hostname.toLowerCase();

  // Check against blocked hostnames
  if (BLOCKED_HOSTS.includes(hostname)) {
    throw new Error('Access to internal resources is not allowed');
  }

  // Check if hostname is an IP address
  const isIpAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname) || hostname.startsWith('[');

  if (isIpAddress) {
    // Check against blocked IP patterns
    for (const pattern of BLOCKED_IP_PATTERNS) {
      if (pattern.test(hostname)) {
        throw new Error('Access to private IP ranges is not allowed');
      }
    }
  } else {
    // Resolve hostname to IP and check if it's private
    try {
      const addresses = await dns.resolve4(hostname).catch(() => []);
      for (const address of addresses) {
        for (const pattern of BLOCKED_IP_PATTERNS) {
          if (pattern.test(address)) {
            throw new Error('Hostname resolves to a private IP address');
          }
        }
        // Check against specific blocked IPs
        if (BLOCKED_HOSTS.includes(address)) {
          throw new Error('Hostname resolves to a blocked IP address');
        }
      }
    } catch (error) {
      if (error.message.includes('private') || error.message.includes('blocked')) {
        throw error;
      }
      // DNS resolution failed, but continue anyway (might be IPv6 only)
    }
  }
}

/**
 * Fetch Open Graph metadata from a URL
 * @param {string} url - The URL to fetch metadata from
 * @param {number} redirectCount - Number of redirects followed (internal)
 * @returns {Promise<Object>} - Open Graph metadata
 */
async function fetchLinkPreview(url, redirectCount = 0) {
  // Limit redirect depth to prevent infinite loops
  const MAX_REDIRECTS = 5;
  if (redirectCount > MAX_REDIRECTS) {
    throw new Error('Too many redirects');
  }

  // Validate URL to prevent SSRF
  await validateUrl(url);

  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const options = {
        method: 'GET',
        timeout: 5000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; KeepLocalBot/1.0; +http://localhost:3000)',
          'Accept': 'text/html,application/xhtml+xml'
        }
      };

      const request = protocol.get(url, options, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          return fetchLinkPreview(response.headers.location, redirectCount + 1)
            .then(resolve)
            .catch(reject);
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

    } catch (error) {
      reject(error);
    }
  });
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
