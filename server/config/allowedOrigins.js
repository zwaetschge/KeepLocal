const PUBLIC_DEMO_ORIGIN = 'https://keep-local-silk.vercel.app';
function configuredOrigins(env = process.env) {
  const origins = String(env.ALLOWED_ORIGINS || 'http://localhost:3000')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  // The packaged public demo has one published frontend. Private installations
  // continue to use only their explicit allowlist; proxy headers grant no trust.
  if (env.DEMO_MODE === 'true') {
    const value = env.DEMO_FRONTEND_ORIGIN || PUBLIC_DEMO_ORIGIN;
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:' || parsed.origin !== value)
      throw new Error('DEMO_FRONTEND_ORIGIN must be an exact HTTPS origin');
    origins.push(value);
  }
  return [...new Set(origins)];
}
module.exports = { configuredOrigins, PUBLIC_DEMO_ORIGIN };
