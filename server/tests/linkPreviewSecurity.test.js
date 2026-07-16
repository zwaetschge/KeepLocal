const test = require('node:test');
const assert = require('node:assert/strict');

const { isBlockedIp, validateUrlSafety, parseOpenGraphTags } = require('../utils/linkPreview');

test('link preview blocks private, loopback, mapped, multicast, and reserved addresses', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '255.255.255.255',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1'
  ];

  for (const address of blocked) {
    assert.equal(isBlockedIp(address), true, `${address} should be blocked`);
  }
});

test('link preview permits public IPv4 and global IPv6 addresses', () => {
  assert.equal(isBlockedIp('8.8.8.8'), false);
  assert.equal(isBlockedIp('1.1.1.1'), false);
  assert.equal(isBlockedIp('2606:4700:4700::1111'), false);
});

test('link preview rejects URLs containing embedded credentials', async () => {
  await assert.rejects(
    validateUrlSafety(new URL('https://user:password@8.8.8.8/page')),
    error => error.statusCode === 400 && /Zugangsdaten/.test(error.message)
  );
});

test('parsed metadata is bounded to the note schema limits', () => {
  const title = 't'.repeat(500);
  const description = 'd'.repeat(1000);
  const site = 's'.repeat(300);
  const parsed = parseOpenGraphTags(
    `<meta property="og:title" content="${title}">` +
    `<meta property="og:description" content="${description}">` +
    `<meta property="og:site_name" content="${site}">`,
    'https://example.com'
  );

  assert.equal(parsed.title.length, 200);
  assert.equal(parsed.description.length, 500);
  assert.equal(parsed.siteName.length, 100);
});
