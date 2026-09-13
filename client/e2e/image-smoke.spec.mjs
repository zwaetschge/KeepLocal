import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_FIXTURE = path.join(here, '../public/icon-192.png');

/**
 * Smoke suite against the PUBLISHED image.
 *
 * Warum (Audit 2026-09-12, Top-30 Nr. 22): `docker-build.yml` „testete" das
 * Image mit `sleep 45` und vier Curls. Die Playwright-Suite lief ausschließlich
 * gegen den Source-Build mit `node server.js` — also nie gegen das, was
 * Self-Hoster tatsächlich ausführen: nginx (Routing, CSP, `client_max_body_size`,
 * `/uploads`-Proxy), supervisord, der All-in-One-Start mit mongod und Whisper im
 * selben Container, der Entrypoint mit seinen Permission-Reparaturen und
 * `AI_SERVICE_TOKEN`, und das gebaute Client-Bundle aus dem Image.
 *
 * Diese Suite läuft gegen einen bereits laufenden Container
 * (`IMAGE_BASE_URL`, Default http://localhost:3000) und startet nichts selbst.
 * Sie wird in CI nur auf der amd64-Achse ausgeführt — Chromium unter
 * qemu-arm64-Emulation ist zu langsam und flaky.
 */

const ADMIN = { username: 'imagesmoke', email: 'imagesmoke@example.com', password: 'ImageSmoke12x' };
const TITLE = 'Image-Smoke Notiz';
const CONTENT = 'Preis < 100 EUR & Tom <3 Jerry';

const errorBoundaryText = /Etwas ist schiefgelaufen|Something went wrong/;

test.describe.serial('published all-in-one image', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // Eine gemeinsame Seite wie in der Source-Suite: Die Tests bauen aufeinander
  // auf (Setup → Notiz → Bild → Suche/Papierkorb), und jeder Test mit eigener
  // Page hätte einen frischen Kontext ohne Sitzungs-Cookie — also den
  // Login-Screen statt der App.
  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('pageerror', (error) => {
      throw new Error(`uncaught page error: ${error.message}`);
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('readiness is green and hides internals in production', async () => {
    const request = page.request;
    const live = await request.get('/api/health/live');
    expect(live.status(), 'the node process must be up behind nginx').toBe(200);

    const ready = await request.get('/api/health/ready');
    expect(ready.status(), await ready.text()).toBe(200);
    const body = await ready.json();
    expect(body.ready).toBe(true);
    expect(body.database.status).toBe('connected');
    expect(body.uploads.writable).toBe(true);
    // NODE_ENV=production im Image: keine internen Pfade/DB-Fehlertexte.
    expect(body.database.detail).toBeUndefined();
    expect(body.uploads.detail).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('/app/server/uploads');
  });

  test('the app is served by nginx and the initial setup creates the admin', async () => {
    await page.goto('/');
    await expect(page.locator('form.auth-form')).toBeVisible({ timeout: 30000 });

    if (await page.locator('#confirmPassword').count()) {
      // Erstinstallation: der Setup-Wizard legt den ersten Admin an. In CI ist
      // das immer dieser Pfad (frischer Container, leeres Volume).
      await page.fill('#username', ADMIN.username);
      await page.fill('#email', ADMIN.email);
      await page.fill('#password', ADMIN.password);
      await page.fill('#confirmPassword', ADMIN.password);
    } else {
      // Bereits eingerichtet — z. B. ein lokaler Re-Run gegen dasselbe Volume.
      await page.fill('input[type="email"], form input[type="text"]', ADMIN.email);
      await page.fill('form input[type="password"]', ADMIN.password);
    }
    await page.click('form.auth-form button[type="submit"]');

    await expect(page.locator('.App')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('.empty-state')).toBeVisible();
    await expect(page.locator('body')).not.toContainText(errorBoundaryText);
  });

  test('a note with special characters survives a reload', async () => {
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', TITLE);
    await page.fill('.note-modal-content', CONTENT);
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    const card = page.locator('[role="article"]', { hasText: TITLE });
    await expect(card.locator('.note-content')).toContainText('Preis < 100 EUR & Tom <3 Jerry');
    await expect(card.locator('.note-content')).not.toContainText('&amp;');

    await page.reload();
    await expect(page.locator('.App')).toBeVisible({ timeout: 30000 });
    await expect(page.locator('[role="article"]', { hasText: TITLE })).toBeVisible({ timeout: 20000 });
  });

  test('an image upload goes through nginx, sharp and the authorized file route', async () => {
    await page.locator('[role="article"]', { hasText: TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.setInputFiles('#image-upload-input', UPLOAD_FIXTURE);
    await expect(page.locator('.new-images-preview .image-preview')).toHaveCount(1);
    await page.locator('.btn-modal-image-upload').click();
    await expect(page.locator('.note-modal-images .image-preview')).toHaveCount(1, { timeout: 30000 });
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    const card = page.locator('[role="article"]', { hasText: TITLE });
    await expect(card.locator('.note-image-preview img').first()).toBeVisible({ timeout: 20000 });

    // Die Datei liegt wirklich im Image-Server-Pfad (nginx -> Express ->
    // secureFileServe) und wird nicht vom Service Worker erfunden.
    const response = await page.request.get(
      await card.locator('.note-image-preview img').first().getAttribute('src')
    );
    expect(response.status(), 'the uploaded image must be served').toBe(200);
    expect(response.headers()['cache-control']).toContain('no-store');
  });

  test('search and trash work in the image', async () => {
    await page.fill('.search-input', 'zzz-keine-treffer');
    await expect(page.locator('.empty-state')).toBeVisible({ timeout: 20000 });
    await page.fill('.search-input', 'Preis');
    await expect(page.locator('[role="article"]', { hasText: TITLE })).toBeVisible({ timeout: 20000 });
    await page.locator('.search-clear').click();

    const card = page.locator('[role="article"]', { hasText: TITLE });
    await card.hover();
    await card.locator('.delete-btn').click();
    await expect(page.locator('.confirm-dialog')).toBeVisible();
    await page.locator('.confirm-dialog .btn-confirm').click();
    await expect(page.locator('[role="article"]', { hasText: TITLE })).toHaveCount(0, { timeout: 20000 });

    const undo = page.locator('.toast .toast-action');
    await expect(undo).toBeVisible({ timeout: 10000 });
    await undo.click();
    await expect(page.locator('[role="article"]', { hasText: TITLE })).toBeVisible({ timeout: 20000 });
    await expect(page.locator('body')).not.toContainText(errorBoundaryText);
  });
});
