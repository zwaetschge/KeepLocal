import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright-Konfiguration für die Image-Smoke-Suite (e2e/image-smoke.spec.mjs).
 *
 * Unterschied zur normalen E2E-Konfiguration: Hier wird **nichts gestartet**.
 * Getestet wird ein bereits laufendes KeepLocal — in CI der gerade gebaute und
 * gepushte Container aus `docker-build.yml`, lokal z. B.:
 *
 *   docker run -d --name keeplocal-image-test -p 3000:80 \
 *     -e JWT_SECRET="$(openssl rand -hex 32)" \
 *     -e ALLOWED_ORIGINS=http://localhost:3000 -e NODE_ENV=production \
 *     valentin2177/keeplocal:latest
 *   IMAGE_BASE_URL=http://localhost:3000 npm run test:e2e:image
 *
 * Nützlich:
 *   IMAGE_BASE_URL           Default http://localhost:3000
 *   PLAYWRIGHT_CHROMIUM_PATH System-Chromium statt des heruntergeladenen
 */
const BASE_URL = process.env.IMAGE_BASE_URL || 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  testMatch: 'image-smoke.spec.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  outputDir: './test-results',
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Kein Video: ffmpeg ist nicht überall vorhanden, und ein fehlendes ffmpeg
    // überdeckt den eigentlichen Testfehler mit „Executable doesn't exist".
    video: 'off',
    actionTimeout: 20_000,
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
});
