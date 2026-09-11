import { test, expect, request as pwRequest } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * KeepLocal end-to-end smoke suite.
 *
 * Every assertion here corresponds to a defect that shipped while all unit
 * suites, ESLint and the production build were green (see
 * BUG_REPORT_2026-08-15.md and BUG_REPORT_2026-09-10.md). The suite runs
 * against the real production bundle, the real Express server and a real
 * MongoDB, in one serial browser session plus isolated contexts where a second
 * user or a broken deploy is needed.
 */

const ADMIN = { username: 'e2eadmin', email: 'e2eadmin@example.com', password: 'E2eAdmin123x' };
const FRIEND = { username: 'e2efriend', email: 'e2efriend@example.com', password: 'E2eFriend12x' };
const SPECIAL_CONTENT = 'Preis < 100 EUR & Tom <3 Jerry\nif a < b then c > d';
const NOTE_TITLE = 'Sonderzeichen';
const UPLOAD_FIXTURE = path.join(here, '../public/icon-192.png');

const errorBoundaryText = /Etwas ist schiefgelaufen|Something went wrong/;

/** CSRF token for mutations issued through page.request (cookie jar is shared). */
async function csrfToken(request) {
  const response = await request.get('/api/csrf-token');
  expect(response.ok()).toBeTruthy();
  const body = await response.json();
  return body.csrfToken;
}

async function api(request, method, url, body) {
  const token = await csrfToken(request);
  const response = await request.fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status(), body: await response.json().catch(() => null) };
}

async function noteTotal(page) {
  const response = await page.request.get('/api/notes?page=1&limit=100&archived=false');
  const body = await response.json();
  return body.pagination.total;
}

async function expectAppHealthy(page) {
  await expect(page.locator('.App')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(errorBoundaryText);
}

test.describe.serial('KeepLocal production smoke', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    page.on('pageerror', (error) => {
      // Surface runtime crashes as test failures instead of console noise.
      throw new Error(`uncaught page error: ${error.message}`);
    });
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test('initial setup creates the admin account and renders the app', async () => {
    await page.goto('/');
    await expect(page.locator('#username')).toBeVisible();

    await page.fill('#username', ADMIN.username);
    await page.fill('#email', ADMIN.email);
    await page.fill('#password', ADMIN.password);
    await page.fill('#confirmPassword', ADMIN.password);
    await page.click('form.auth-form button[type="submit"]');

    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('.empty-state')).toBeVisible();
  });

  test('a note with < and & is stored verbatim and rendered unescaped', async () => {
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', NOTE_TITLE);
    await page.fill('.note-modal-content', SPECIAL_CONTENT);
    await expect(page.locator('.btn-modal-save')).toBeEnabled();
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0);

    const card = page.locator('[role="article"]', { hasText: NOTE_TITLE });
    await expect(card.locator('.note-content')).toContainText('Preis < 100 EUR & Tom <3 Jerry');
    await expect(card.locator('.note-content')).not.toContainText('&amp;');

    const list = await (await page.request.get('/api/notes?page=1&limit=50&archived=false')).json();
    const stored = list.notes.find((note) => note.title === NOTE_TITLE);
    expect(stored, 'note was not persisted').toBeTruthy();
    expect(stored.content).toBe(SPECIAL_CONTENT);
  });

  test('closing the editor keeps the app alive (unmount crash regression)', async () => {
    for (const close of ['cancel', 'escape']) {
      await page.click('.note-form-button');
      await expect(page.locator('.note-modal')).toBeVisible();
      if (close === 'cancel') {
        await page.click('.btn-modal-cancel');
      } else {
        await page.keyboard.press('Escape');
      }
      await expect(page.locator('.note-modal')).toHaveCount(0);
      await expectAppHealthy(page);
    }
  });

  test('uploading an image and saving again does not raise a false conflict', async () => {
    await page.locator('[role="article"]', { hasText: NOTE_TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();

    await page.setInputFiles('#image-upload-input', UPLOAD_FIXTURE);
    await expect(page.locator('.new-images-preview .image-preview')).toHaveCount(1);
    await page.click('.btn-modal-image-upload');
    await expect(page.locator('.note-modal-images .image-preview')).toHaveCount(1, { timeout: 25000 });

    await page.click('.note-modal-content');
    await page.keyboard.type(' + nach Upload');
    await page.click('.btn-modal-save');

    await expect(page.locator('.note-modal-conflict')).toHaveCount(0);
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await expectAppHealthy(page);
  });

  test('Ctrl+N keeps the open editor instead of creating a duplicate', async () => {
    const totalBefore = await noteTotal(page);
    await page.locator('[role="article"]', { hasText: NOTE_TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();

    await page.click('.note-modal-content');
    await page.keyboard.type(' EDIT');
    await page.keyboard.press('Control+n');
    await page.waitForTimeout(800);

    // The editor must still be in "edit existing note" mode: owner-only tools
    // (archive/delete) disappear as soon as noteModal.note becomes null.
    await expect(page.locator('.note-modal-title')).toHaveValue(NOTE_TITLE);
    await expect(page.locator('.btn-modal-delete')).toBeVisible();

    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    expect(await noteTotal(page), 'saving must update, not duplicate').toBe(totalBefore);
  });

  test('a link in the content never produces a server error', async () => {
    const statuses = [];
    const onResponse = (response) => {
      if (response.url().includes('/api/notes/link-preview')) statuses.push(response.status());
    };
    page.on('response', onResponse);

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', 'Link-Notiz');
    await page.fill('.note-modal-content', 'Siehe https://example.com/keeplocal-e2e fuer Details');
    // The hook debounces 1s and the fetch may legitimately fail offline; the
    // point is that it must not be a 5xx.
    await page.waitForTimeout(9000);

    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    page.off('response', onResponse);

    expect(statuses.length, 'link preview was never requested').toBeGreaterThan(0);
    for (const status of statuses) {
      // 4xx/502 are legitimate "that link is broken or unreachable" answers;
      // a 500 would mean the server faulted on a user-pasted link (offline CI
      // runners resolve nothing, so the suite must tolerate the 502).
      expect(
        [200, 400, 403, 404, 422, 502].includes(status),
        `link-preview answered ${status}`
      ).toBeTruthy();
    }
  });

  test('search finds special characters and reports an empty state', async () => {
    await page.fill('.search-input', '<3');
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toBeVisible();

    await page.fill('.search-input', 'zzz-keine-treffer');
    await expect(page.locator('.empty-state')).toBeVisible();

    await page.click('.search-clear');
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toBeVisible();
  });

  test('archiving moves the note between the views and updates counts', async () => {
    const card = page.locator('[role="article"]', { hasText: NOTE_TITLE });
    await card.hover();
    await card.locator('.archive-btn').click();
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toHaveCount(0, { timeout: 20000 });

    await page.locator('.sidebar-item[aria-label="Archived"]').click();
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toBeVisible({ timeout: 20000 });

    const archivedCard = page.locator('[role="article"]', { hasText: NOTE_TITLE });
    await archivedCard.hover();
    await archivedCard.locator('.archive-btn').click();
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toHaveCount(0, { timeout: 20000 });

    await page.locator('.sidebar-item[aria-label="All Notes"]').click();
    await expect(page.locator('[role="article"]', { hasText: NOTE_TITLE })).toBeVisible({ timeout: 20000 });
    await expectAppHealthy(page);
  });

  test('deleted notes go to the trash with undo, restore and purge', async () => {
    const TRASH_TITLE = 'Trash-Notiz';

    // A note of its own, so the sharing test below keeps its fixture.
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', TRASH_TITLE);
    await page.fill('.note-modal-content', 'wird gleich geloescht');
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    const deleteNote = async () => {
      const card = page.locator('[role="article"]', { hasText: TRASH_TITLE });
      await card.hover();
      await card.locator('.delete-btn').click();
      await expect(page.locator('.confirm-dialog')).toBeVisible();
      await page.locator('.confirm-dialog .btn-confirm').click();
      await expect(page.locator('.confirm-dialog')).toHaveCount(0);
      await expect(page.locator('[role="article"]', { hasText: TRASH_TITLE })).toHaveCount(0, { timeout: 20000 });
    };

    // 1) Delete shows an undo toast and undo brings the note back.
    await deleteNote();
    const undo = page.locator('.toast .toast-action');
    await expect(undo).toBeVisible({ timeout: 10000 });
    await expect(undo).toContainText(/Undo|Rückgängig/i);
    await undo.click();
    await expect(page.locator('[role="article"]', { hasText: TRASH_TITLE })).toBeVisible({ timeout: 20000 });

    // 2) Delete again, then restore from the trash view.
    await deleteNote();
    await page.locator('.sidebar-item[aria-label="Trash"]').click();
    await expect(page.locator('.trash-header')).toBeVisible();
    const trashCard = page.locator('[role="article"]', { hasText: TRASH_TITLE });
    await expect(trashCard).toBeVisible({ timeout: 20000 });
    // Trash cards offer restore/purge only — no pin, archive, share or edit.
    await trashCard.hover();
    await expect(trashCard.locator('.restore-btn')).toBeVisible();
    await expect(trashCard.locator('.purge-btn')).toBeVisible();
    await expect(trashCard.locator('.pin-btn')).toHaveCount(0);
    await expect(trashCard.locator('.archive-btn')).toHaveCount(0);
    await expect(trashCard.locator('.collaborate-btn')).toHaveCount(0);
    await expect(page.locator('.note-form-button')).toHaveCount(0);

    await trashCard.locator('.restore-btn').click();
    await expect(page.locator('[role="article"]', { hasText: TRASH_TITLE })).toHaveCount(0, { timeout: 20000 });
    await page.locator('.sidebar-item[aria-label="All Notes"]').click();
    await expect(page.locator('[role="article"]', { hasText: TRASH_TITLE })).toBeVisible({ timeout: 20000 });

    // 3) Purge removes it for good (gone from both lists on the server).
    await deleteNote();
    await page.locator('.sidebar-item[aria-label="Trash"]').click();
    const purgeCard = page.locator('[role="article"]', { hasText: TRASH_TITLE });
    await expect(purgeCard).toBeVisible({ timeout: 20000 });
    await purgeCard.hover();
    await purgeCard.locator('.purge-btn').click();
    await expect(page.locator('.confirm-dialog')).toBeVisible();
    await expect(page.locator('.confirm-dialog')).toContainText(/forever|endgültig/i);
    await page.locator('.confirm-dialog .btn-confirm').click();
    await expect(page.locator('[role="article"]', { hasText: TRASH_TITLE })).toHaveCount(0, { timeout: 20000 });

    const afterPurge = await page.evaluate(async () => {
      const [active, trash] = await Promise.all([
        fetch('/api/notes?page=1&limit=100&archived=false', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/notes?page=1&limit=100&deleted=true', { credentials: 'include' }).then(r => r.json()),
      ]);
      return {
        active: active.notes.some(n => n.title === 'Trash-Notiz'),
        trash: trash.notes.some(n => n.title === 'Trash-Notiz'),
      };
    });
    expect(afterPurge).toEqual({ active: false, trash: false });
    await expectAppHealthy(page);

    // 4) Empty trash clears everything that is left.
    await page.locator('.sidebar-item[aria-label="All Notes"]').click();
    await expect(page.locator('.App')).toBeVisible();
    const trashCount = await page.evaluate(async () => {
      const r = await fetch('/api/notes?page=1&limit=1&archived=false', { credentials: 'include' });
      return (await r.json()).counts.trash;
    });
    if (trashCount > 0) {
      await page.locator('.sidebar-item[aria-label="Trash"]').click();
      await expect(page.locator('.trash-header')).toBeVisible();
      await page.locator('.btn-empty-trash').click();
      await expect(page.locator('[role="article"]')).toHaveCount(0, { timeout: 20000 });
      await expect(page.locator('.empty-state')).toBeVisible();
    }
    await page.locator('.sidebar-item[aria-label="All Notes"]').click();
    await expect(page.locator('[role="article"]').first()).toBeVisible({ timeout: 20000 });
  });

  test('sharing updates the modal in place and the collaborator can edit', async ({ browser }) => {
    // Second user + friendship, created through the API as the admin.
    const created = await api(page.request, 'POST', '/api/admin/users', FRIEND);
    expect([201, 409], `create friend user: ${created.status} ${JSON.stringify(created.body)}`).toContain(created.status);

    const friendRequest = await pwRequest.newContext({ baseURL: page.url().replace(/\/$/, '') });
    const login = await api(friendRequest, 'POST', '/api/auth/login', { email: FRIEND.email, password: FRIEND.password });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    const sent = await api(friendRequest, 'POST', '/api/friends/request', { username: ADMIN.username });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);

    const pending = await (await page.request.get('/api/friends/requests')).json();
    expect(pending.length).toBeGreaterThan(0);
    const accepted = await api(page.request, 'POST', `/api/friends/accept/${pending[0]._id}`);
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    // Share through the UI and check the state flips without reopening.
    await page.locator('[role="article"]', { hasText: NOTE_TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.click('.btn-modal-collaborate');
    await expect(page.locator('.collaborate-modal')).toBeVisible();
    await expect(page.locator('.collaborate-modal .friend-item', { hasText: FRIEND.username })).toBeVisible();

    const shareButton = page.locator('.collaborate-modal .friend-item', { hasText: FRIEND.username }).locator('.btn-share');
    if (!(await shareButton.evaluate((el) => el.classList.contains('shared')))) {
      await shareButton.click();
    }
    await expect(shareButton).toHaveClass(/shared/, { timeout: 15000 });
    await expect(shareButton).toContainText(/Shared|Geteilt/);
    await expect(page.locator('.shared-with-section')).toContainText(FRIEND.username);
    await page.keyboard.press('Escape');
    await expect(page.locator('.collaborate-modal')).toHaveCount(0);
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 15000 });

    // The collaborator opens the same note in an isolated context and edits it.
    const friendContext = await browser.newContext();
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/');
    await friendPage.fill('input[type="email"], form input[type="text"]', FRIEND.email);
    await friendPage.fill('form input[type="password"]', FRIEND.password);
    await friendPage.click('form button[type="submit"]');
    await expect(friendPage.locator('.App')).toBeVisible({ timeout: 25000 });

    const sharedCard = friendPage.locator('[role="article"]', { hasText: NOTE_TITLE });
    await expect(sharedCard).toBeVisible({ timeout: 20000 });
    // Owner-only actions must not be offered to a collaborator.
    await sharedCard.hover();
    await expect(sharedCard.locator('.archive-btn')).toHaveCount(0);
    await expect(sharedCard.locator('.delete-btn')).toHaveCount(0);

    await sharedCard.click();
    await expect(friendPage.locator('.note-modal')).toBeVisible();
    await expect(friendPage.locator('.note-modal-shared-hint')).toBeVisible();
    await expect(friendPage.locator('.btn-modal-delete')).toHaveCount(0);
    await expect(friendPage.locator('.btn-modal-archive')).toHaveCount(0);
    await friendPage.click('.note-modal-content');
    await friendPage.keyboard.type(' + von e2efriend');
    await friendPage.click('.btn-modal-save');
    await expect(friendPage.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await expect(friendPage.locator('body')).not.toContainText(errorBoundaryText);
    await friendContext.close();
    await friendRequest.dispose();

    // The owner sees the collaborator's change after a refresh.
    await page.reload();
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });
    const list = await (await page.request.get('/api/notes?page=1&limit=50&archived=false')).json();
    const shared = list.notes.find((note) => note.title === NOTE_TITLE);
    expect(shared.content).toContain('von e2efriend');
  });

  test('logout and login again without a reload works (CSRF lifecycle)', async () => {
    await page.click('.btn-logout');
    await expect(page.locator('form input[type="password"]')).toBeVisible({ timeout: 20000 });

    // Error codes: the API answers in German, the UI must translate via the
    // stable code instead of showing the server prose.
    await page.fill('input[type="email"], form input[type="text"]', ADMIN.email);
    await page.fill('form input[type="password"]', 'DefinitelyWrong1x');
    await page.click('form button[type="submit"]');
    await expect(page.locator('.auth-error')).toBeVisible({ timeout: 15000 });
    const errorText = (await page.locator('.auth-error').innerText()).trim();
    expect(errorText).toMatch(/Email or password is incorrect/i);
    expect(errorText).not.toMatch(/Ungültige Anmeldedaten/);

    await page.fill('input[type="email"], form input[type="text"]', ADMIN.email);
    await page.fill('form input[type="password"]', ADMIN.password);
    await page.click('form button[type="submit"]');
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });

    // A mutation right after the re-login must not fail with a stale CSRF token.
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-content', 'Notiz nach Re-Login');
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await expect(page.locator('[role="article"]', { hasText: 'Notiz nach Re-Login' })).toBeVisible();
    await expectAppHealthy(page);
  });

  test('mobile viewport has no overflow and the editor fits', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.innerWidth + 1);

    await page.click('.mobile-menu-toggle');
    // The sidebar slides in with a CSS transition, so poll instead of measuring
    // the mid-animation position once.
    await expect
      .poll(async () => (await page.locator('.sidebar').boundingBox())?.x, { timeout: 8000 })
      .toBeGreaterThanOrEqual(0);
    await expect(page.locator('.sidebar-overlay')).toBeVisible();
    // The drawer covers the left part of the overlay, so close it by clicking
    // the visible area to its right (like a thumb would).
    await page.locator('.sidebar-overlay').click({ position: { x: 360, y: 400 } });
    await expect
      .poll(async () => (await page.locator('.sidebar').boundingBox())?.x, { timeout: 8000 })
      .toBeLessThan(0);

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();

    // A tall note must not push the footer (Cancel/Save) out of the viewport:
    // the dialog body scrolls, the footer stays reachable.
    await page.fill('.note-modal-title', 'Mobile-Notiz');
    await page.fill(
      '.note-modal-content',
      Array.from({ length: 60 }, (_unused, index) => `Zeile ${index + 1} mit etwas Text zum Fuellen`).join('\n')
    );
    await page.waitForTimeout(400);

    const box = await page.locator('.note-modal').boundingBox();
    expect(box.y).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height, 'dialog taller than the viewport').toBeLessThanOrEqual(845);

    await expect(page.locator('.btn-modal-save')).toBeVisible();
    const saveBox = await page.locator('.btn-modal-save').boundingBox();
    expect(saveBox.y + saveBox.height, 'save button below the fold').toBeLessThanOrEqual(845);

    // Actually click it — Playwright fails when the button is covered or off-screen.
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await expectAppHealthy(page);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test('axe finds no serious accessibility violations on the main screens', async () => {
    const axeSource = fs.readFileSync(path.join(here, '../node_modules/axe-core/axe.min.js'), 'utf8');

    const runAxe = async (label) => {
      // Let CSS entry animations (modalSlideUp, listFadeIn) finish: axe blends
      // foreground and background with the current opacity, so measuring mid
      // animation reports bogus contrast ratios (~1.1:1 for every element).
      await page.waitForTimeout(800);
      await page.evaluate(axeSource);
      const results = await page.evaluate(() => window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
      }));
      const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
      for (const v of serious) {
        for (const n of v.nodes.slice(0, 6)) {
          console.log(`AXE-DETAIL ${label} ${v.id} :: target=${JSON.stringify(n.target)} :: ${n.failureSummary?.split('\n')[0]} :: html=${(n.html || '').slice(0, 140)}`);
          for (const item of [...(n.any || []), ...(n.all || [])]) {
            if (item.data) console.log(`AXE-DATA ${v.id} ${item.id}: ${JSON.stringify(item.data).slice(0, 300)}`);
          }
        }
      }
      expect(serious.map((v) => `${label}: ${v.id} (${v.impact}) — ${v.help}`).join('\n')).toBe('');
    };

    await expect(page.locator('.App')).toBeVisible();
    await runAxe('notes list');

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await runAxe('note editor');
    await page.click('.btn-modal-cancel');
    await expect(page.locator('.note-modal')).toHaveCount(0);

    await page.click('.user-name.clickable');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await runAxe('settings');
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);
  });

  test('a dead bundle is forwarded to the recovery page and stops there', async ({ browser }) => {
    const context = await browser.newContext();
    const broken = await context.newPage();
    // Simulate the classic broken deploy: cached index.html, hashed bundle gone.
    await broken.route('**/assets/**', (route) => route.abort());

    await broken.goto('/');
    await broken.waitForURL(/\/recover\.html/, { timeout: 30000 });
    expect(broken.url()).toContain('auto=1');

    // The automatic repair cannot fix a missing bundle, so the guard has to
    // hand over to the manual recovery UI instead of looping or stranding the
    // user on a blank page.
    await broken.waitForURL(/auto=0/, { timeout: 40000 });
    await expect(broken.locator('#recovery-retry')).toBeVisible();
    await expect(broken.locator('#recovery-open')).toBeVisible();
    await expect(broken.locator('body')).toContainText(/Ready|Bereit|Reparatur|Repair/i);

    const settled = broken.url();
    await broken.waitForTimeout(7000);
    expect(broken.url(), 'recovery page must not redirect again').toBe(settled);
    await context.close();
  });

  // The password tests run last: they change credentials the other tests use.
  test('changing the password keeps this session and invalidates the old password', async ({ browser }) => {
    const nextPassword = 'E2eAdminChanged1x';

    await page.click('.user-name.clickable');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.fill('#current-password', ADMIN.password);
    await page.fill('#new-password', nextPassword);
    await page.fill('#confirm-new-password', nextPassword);
    await page.click('.btn-change-password');

    await expect(page.locator('.settings-error')).toHaveCount(0);
    await expect(page.locator('.toast')).toContainText(/Password changed|Passwort geändert/, { timeout: 15000 });
    // The fields are cleared and this session stays alive.
    await expect(page.locator('#current-password')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);
    await expectAppHealthy(page);
    await expect(page.locator('[role="article"]').first()).toBeVisible();

    // Wrong current password is rejected.
    await page.click('.user-name.clickable');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.fill('#current-password', 'DefinitelyWrong1x');
    await page.fill('#new-password', 'AnotherOne1x');
    await page.fill('#confirm-new-password', 'AnotherOne1x');
    await page.click('.btn-change-password');
    await expect(page.locator('.settings-error')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);

    // A fresh context: the new password works, the old one does not.
    const context = await browser.newContext();
    const other = await context.newPage();
    await other.goto('/');
    await other.fill('input[type="email"], form input[type="text"]', ADMIN.email);
    await other.fill('form input[type="password"]', ADMIN.password);
    await other.click('form button[type="submit"]');
    await expect(other.locator('.auth-error')).toBeVisible({ timeout: 15000 });

    await other.fill('form input[type="password"]', nextPassword);
    await other.click('form button[type="submit"]');
    await expect(other.locator('.App')).toBeVisible({ timeout: 20000 });
    await context.close();

    ADMIN.password = nextPassword;
  });

  test('an admin reset token can be redeemed once from the login screen', async ({ browser }) => {
    // Admin console -> users -> reset token for the collaborator.
    await page.click('.user-name.clickable');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.locator('.settings-modal button', { hasText: /Open admin console|Admin-Konsole öffnen/ }).click();
    await expect(page.locator('.admin-console-overlay')).toBeVisible();
    await page.locator('.admin-tab', { hasText: /Users|Benutzer/ }).click();
    const row = page.locator('.admin-table tbody tr', { hasText: FRIEND.username });
    await expect(row).toBeVisible();
    await row.locator('.btn-reset-token').click();

    await expect(page.locator('.reset-token-box')).toBeVisible({ timeout: 15000 });
    const resetToken = (await page.locator('.reset-token-value code').innerText()).trim();
    expect(resetToken).toMatch(/^[a-f0-9]{64}$/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.admin-console-overlay')).toHaveCount(0);

    // The collaborator redeems the token without being logged in.
    const context = await browser.newContext();
    const friend = await context.newPage();
    await friend.goto('/');
    await friend.locator('.auth-link-button').click();
    await expect(friend.locator('.auth-reset-form')).toBeVisible();
    await friend.fill('#reset-token', resetToken);
    const nextPassword = 'E2eFriendReset1x';
    await friend.fill('#reset-password', nextPassword);
    await friend.fill('#reset-password-confirm', nextPassword);
    await friend.click('.auth-reset-form button[type="submit"]');
    await expect(friend.locator('.auth-success')).toBeVisible({ timeout: 15000 });

    // The token is single use.
    await friend.fill('#reset-token', resetToken);
    await friend.fill('#reset-password', 'AnotherOne2x');
    await friend.fill('#reset-password-confirm', 'AnotherOne2x');
    await friend.click('.auth-reset-form button[type="submit"]');
    await expect(friend.locator('.auth-error')).toBeVisible({ timeout: 15000 });

    // Login with the new password works.
    await friend.reload();
    await friend.fill('input[type="email"], form input[type="text"]', FRIEND.email);
    await friend.fill('form input[type="password"]', nextPassword);
    await friend.click('form button[type="submit"]');
    await expect(friend.locator('.App')).toBeVisible({ timeout: 20000 });
    await context.close();
  });
});
