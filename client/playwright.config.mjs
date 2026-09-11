import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

/**
 * End-to-end smoke suite.
 *
 * Why this exists: three audit rounds found HIGH-impact defects (editor crash on
 * close, 400 when saving a note with a link preview, Ctrl+N creating duplicates,
 * collaborators unable to save) while every unit suite, ESLint and the build
 * were green — nothing rendered the app. This suite drives the real production
 * bundle in Chromium against the real server and MongoDB.
 *
 * Local run:
 *   cd client && npm run test:e2e        # baut, leert die E2E-Datenbank, startet
 *                                        # Server + Static-Server und testet
 *
 * The database reset runs as part of the npm script BEFORE Playwright starts the
 * webServer processes: Playwright launches webServer first and only then would a
 * globalSetup run, so dropping the database there would delete the indexes the
 * server had just created (every $text search then fails with IndexNotFound).
 * Useful env:
 *   E2E_MONGODB_URI        default mongodb://127.0.0.1:27017/keeplocal_e2e
 *   E2E_API_PORT           default 5000
 *   E2E_WEB_PORT           default 4173
 *   PLAYWRIGHT_CHROMIUM_PATH  use a system Chromium instead of a downloaded one
 */
const MONGODB_URI = process.env.E2E_MONGODB_URI || 'mongodb://127.0.0.1:27017/keeplocal_e2e';
const API_PORT = Number(process.env.E2E_API_PORT || 5000);
const WEB_PORT = Number(process.env.E2E_WEB_PORT || 4173);
const API_ORIGIN = `http://127.0.0.1:${API_PORT}`;
const WEB_ORIGIN = `http://127.0.0.1:${WEB_PORT}`;

const serverEnv = {
  // Development mode keeps CORS permissive for the static origin and surfaces
  // error details in logs; the client under test is still the production build.
  NODE_ENV: 'development',
  PORT: String(API_PORT),
  HOST: '127.0.0.1',
  MONGODB_URI,
  JWT_SECRET: 'e2e-only-jwt-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  CSRF_SECRET: 'e2e-only-csrf-secret-0123456789-abcdefghijklmnopqrstuvwxyz',
  COOKIE_SECURE: 'false',
  TRUST_PROXY: 'false',
  ALLOWED_ORIGINS: `${WEB_ORIGIN},http://localhost:${WEB_PORT}`,
  CLIENT_URL: WEB_ORIGIN,
  ENABLE_API_DOCS: 'false',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  use: {
    baseURL: WEB_ORIGIN,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH, args: ['--no-sandbox'] }
      : { args: ['--no-sandbox'] },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
  webServer: [
    {
      command: 'node server.js',
      cwd: path.join(repoRoot, 'server'),
      env: serverEnv,
      url: `${API_ORIGIN}/api/health`,
      timeout: 120_000,
      // Always start a fresh server: the npm script drops the database before
      // Playwright launches these processes, and a reused server would keep
      // running without its indexes (search would then fail with MongoDB
      // IndexNotFound instead of returning no hits).
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node serve-static.mjs',
      cwd: path.join(repoRoot, 'tools'),
      env: {
        PORT: String(WEB_PORT),
        HOST: '127.0.0.1',
        UPSTREAM: API_ORIGIN,
        PROD_ROOT: path.join(repoRoot, 'client/build'),
      },
      url: `${WEB_ORIGIN}/`,
      timeout: 60_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
