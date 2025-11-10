const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Fetch Open Graph metadata from a URL
 * @param {string} url - The URL to fetch metadata from
 * @returns {Promise<Object>} - Open Graph metadata
 */
async function fetchLinkPreview(url) {
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
          return fetchLinkPreview(response.headers.location)
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
