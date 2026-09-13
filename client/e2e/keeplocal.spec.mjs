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
        [200, 400, 403, 404, 422, 429, 502].includes(status),
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

  test('search ranks by relevance, highlights matches and narrows tag counts', async () => {
    // Two notes: one matches in the title, one only in the content.
    for (const [title, content, tag] of [
      ['Brot-Rezept', 'Mehl, Wasser, Salz', 'suchtest'],
      ['Einkauf', 'Bitte Brot kaufen und Apfel mitnehmen', 'suchtest'],
    ]) {
      await page.click('.note-form-button');
      await expect(page.locator('.note-modal')).toBeVisible();
      await page.fill('.note-modal-title', title);
      await page.fill('.note-modal-content', content);
      await page.fill('.note-modal-tags-input', tag);
      await page.keyboard.press('Enter');
      await page.click('.btn-modal-save');
      await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    }

    // Both tagged notes are counted before searching.
    await page.fill('.search-input', '');
    await expect(page.locator('.sidebar-item', { hasText: 'suchtest' })).toContainText('2', { timeout: 20000 });

    await page.fill('.search-input', 'Brot');
    const hits = page.locator('[role="article"] .note-title');
    await expect(hits.first()).toHaveText('Brot-Rezept', { timeout: 20000 });

    // The match is highlighted inside the rendered note content.
    const marks = page.locator('[role="article"] .note-content mark');
    await expect(marks.first()).toBeVisible();
    expect((await marks.first().innerText()).toLowerCase()).toBe('brot');
    // Highlighting must not break links or leak markup.
    const html = await page.locator('[role="article"] .note-content').first().innerHTML();
    expect(html).not.toContain('&lt;mark&gt;');

    // Tag counts follow the search instead of showing the whole view: "Apfel"
    // only occurs in one of the two tagged notes.
    await page.fill('.search-input', 'Apfel');
    await expect(page.locator('[role="article"] .note-title').first()).toHaveText('Einkauf', { timeout: 20000 });
    await expect(page.locator('.sidebar-item', { hasText: 'suchtest' })).toContainText('1', { timeout: 20000 });

    // Escape clears the search and restores the full view.
    await page.locator('.search-input').press('Escape');
    await expect(page.locator('.search-input')).toHaveValue('');
    await expect(page.locator('.sidebar-item', { hasText: 'suchtest' })).toContainText('2', { timeout: 20000 });
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

  test('drag and drop inside a section persists the manual order', async () => {
    const titles = ['Order A', 'Order B', 'Order C'];
    for (const title of titles) {
      await page.click('.note-form-button');
      await expect(page.locator('.note-modal')).toBeVisible();
      await page.fill('.note-modal-title', title);
      await page.fill('.note-modal-content', `Inhalt von ${title}`);
      await page.click('.btn-modal-save');
      await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    }

    const visibleOrder = async () => {
      const all = await page.locator('[role="article"] .note-title').allInnerTexts();
      return all.filter((title) => titles.includes(title));
    };

    const before = await visibleOrder();
    expect(before).toEqual(['Order C', 'Order B', 'Order A'], 'newest first before sorting');

    const cards = page.locator('[role="article"]');
    const sourceIndex = await cards.evaluateAll((nodes, wanted) => {
      const titles = wanted;
      return nodes.findIndex((node) => titles.includes(node.querySelector('.note-title')?.innerText || ''));
    }, ['Order A']);
    // Drag the oldest note ("Order A", last of the three) to the top position.
    await cards.nth(sourceIndex).dragTo(cards.nth(0));
    await page.waitForTimeout(2000);

    const after = await visibleOrder();
    expect(after[0], 'the dragged note must be first now').toBe('Order A');
    expect(after).not.toEqual(before);

    // The server must agree: order values were stored and survive a reload.
    const orders = await page.evaluate(async () => {
      const response = await fetch('/api/notes?page=1&limit=100&archived=false', { credentials: 'include' });
      const body = await response.json();
      return body.notes
        .filter((note) => ['Order A', 'Order B', 'Order C'].includes(note.title))
        .map((note) => ({ title: note.title, order: note.order }));
    });
    expect(orders.every((entry) => entry.order > 0), `orders not persisted: ${JSON.stringify(orders)}`).toBeTruthy();

    await page.reload();
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect(page.locator('[role="article"]').first()).toBeVisible({ timeout: 20000 });
    const afterReload = await visibleOrder();
    expect(afterReload, 'manual order must survive a reload').toEqual(after);
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

    // 4) Empty trash asks first, cancels cleanly and then clears everything.
    await page.locator('.sidebar-item[aria-label="All Notes"]').click();
    await expect(page.locator('.App')).toBeVisible();
    const trashCount = await page.evaluate(async () => {
      const r = await fetch('/api/notes?page=1&limit=1&archived=false', { credentials: 'include' });
      return (await r.json()).counts.trash;
    });
    if (trashCount > 0) {
      await page.locator('.sidebar-item[aria-label="Trash"]').click();
      await expect(page.locator('.trash-header')).toBeVisible();

      // A single click must not wipe the trash: the action is final and has no
      // undo (the undo toast only covers single deletes).
      await page.locator('.btn-empty-trash').click();
      await expect(page.locator('.confirm-dialog')).toBeVisible();
      await expect(page.locator('.confirm-dialog')).toContainText(/for good|endgültig/i);
      await page.locator('.confirm-dialog .btn-cancel-confirm').click();
      await expect(page.locator('.confirm-dialog')).toHaveCount(0);
      await expect(page.locator('[role="article"]').first()).toBeVisible({ timeout: 15000 });

      await page.locator('.btn-empty-trash').click();
      await page.locator('.confirm-dialog .btn-confirm').click();
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

  test('theme and language follow the account, not the browser', async ({ browser }) => {
    const mePreferences = async () => {
      const response = await page.request.get('/api/auth/me');
      return (await response.json()).user.preferences;
    };
    const bodyTheme = () => page.evaluate(() => document.body.className);

    const themeBefore = await bodyTheme();
    const langBefore = await page.evaluate(() => document.documentElement.lang);

    // 1) Switching the theme stores it on the account (debounced write-back).
    await page.click('.theme-toggle');
    await expect.poll(bodyTheme, { timeout: 5000 }).not.toBe(themeBefore);
    const themeAfter = await bodyTheme();
    await expect
      .poll(async () => (await mePreferences()).theme, { timeout: 10000 })
      .toBe(themeAfter.replace('-mode', ''));

    // 2) A second device (isolated context, same account) gets it too.
    const context = await browser.newContext();
    const other = await context.newPage();
    await other.goto('/');
    await other.fill('input[type="email"], form input[type="text"]', ADMIN.email);
    await other.fill('form input[type="password"]', ADMIN.password);
    await other.click('form button[type="submit"]');
    await expect(other.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect.poll(() => other.evaluate(() => document.body.className), { timeout: 10000 })
      .toBe(themeAfter);

    // 3) The UI language is an account preference as well.
    await page.click('.user-name.clickable');
    await expect(page.locator('.settings-modal')).toBeVisible();
    await page.locator('.settings-language .language-toggle').click();
    await expect(page.locator('.language-popup')).toBeVisible();
    const targetLang = langBefore === 'de' ? 'English' : 'Deutsch';
    const expectedCode = langBefore === 'de' ? 'en' : 'de';
    await page.locator('.language-option', { hasText: targetLang }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', expectedCode);
    await expect
      .poll(async () => (await mePreferences()).language, { timeout: 10000 })
      .toBe(expectedCode);

    // The second device picks it up on the next load.
    await other.reload();
    await expect(other.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect(other.locator('html')).toHaveAttribute('lang', expectedCode, { timeout: 10000 });
    await context.close();

    // 4) Restore the previous state so the remaining tests stay deterministic.
    //    The settings modal is still open, so switch the language back in place.
    if (langBefore !== expectedCode) {
      await page.locator('.settings-language .language-toggle').click();
      await page.locator('.language-option', { hasText: langBefore === 'de' ? 'Deutsch' : 'English' }).click();
      await expect(page.locator('html')).toHaveAttribute('lang', langBefore);
    }
    await page.keyboard.press('Escape');
    await expect(page.locator('.settings-modal')).toHaveCount(0);

    for (let step = 0; step < 5; step += 1) {
      if ((await bodyTheme()) === themeBefore) break;
      await page.click('.theme-toggle');
      await page.waitForTimeout(300);
    }
    expect(await bodyTheme(), 'theme restored').toBe(themeBefore);
    await expect
      .poll(async () => (await mePreferences()).theme, { timeout: 10000 })
      .toBe(themeBefore.replace('-mode', '') || 'light');
  });

  test('a collaborator can add an image and the owner sees who edited last', async ({ browser }) => {
    const TITLE = 'Bild-Notiz';
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', TITLE);
    await page.fill('.note-modal-content', 'für den Mitbearbeiter');
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    // Share it with the collaborator created earlier.
    await page.locator('[role="article"]', { hasText: TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.click('.btn-modal-collaborate');
    await expect(page.locator('.collaborate-modal')).toBeVisible();
    const shareButton = page.locator('.collaborate-modal .friend-item', { hasText: FRIEND.username }).locator('.btn-share');
    if (!(await shareButton.evaluate((el) => el.classList.contains('shared')))) {
      await shareButton.click();
    }
    await expect(shareButton).toHaveClass(/shared/, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.collaborate-modal')).toHaveCount(0);

    // The collaborator uploads an image — allowed since images are content.
    const context = await browser.newContext();
    const friend = await context.newPage();
    await friend.goto('/');
    await friend.fill('input[type="email"], form input[type="text"]', FRIEND.email);
    await friend.fill('form input[type="password"]', FRIEND.password);
    await friend.click('form button[type="submit"]');
    await expect(friend.locator('.App')).toBeVisible({ timeout: 25000 });
    await friend.locator('[role="article"]', { hasText: TITLE }).click();
    await expect(friend.locator('.note-modal')).toBeVisible();
    await expect(friend.locator('#image-upload-input')).toHaveCount(1, 'collaborators may upload images');
    await friend.locator('.note-modal-content').click();
    await friend.keyboard.type(' + Bild vom Mitbearbeiter');
    await friend.setInputFiles('#image-upload-input', UPLOAD_FIXTURE);
    await expect(friend.locator('.new-images-preview .image-preview')).toHaveCount(1);
    await friend.locator('.btn-modal-image-upload').click();
    await expect(friend.locator('.note-modal-images .image-preview')).toHaveCount(1, { timeout: 25000 });
    await friend.locator('.btn-modal-save').click();
    await expect(friend.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await context.close();

    // The owner sees the image and who edited last.
    await page.reload();
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });
    const card = page.locator('[role="article"]', { hasText: TITLE });
    await expect(card).toBeVisible({ timeout: 20000 });
    await expect(card.locator('.note-image-preview img').first()).toBeVisible();
    await expect(card.locator('.note-edited-by')).toContainText(new RegExp(FRIEND.username));
  });

  test('an edit from elsewhere raises the conflict banner in an open editor', async () => {
    const TITLE = 'Konflikt-Notiz';
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', TITLE);
    await page.fill('.note-modal-content', 'Ausgangszustand');
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    await page.locator('[role="article"]', { hasText: TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.locator('.note-modal-content').click();
    await page.keyboard.type(' + lokaler Tippfehler');

    // Another client changes the same note while this editor is open.
    const noteId = await page.evaluate(async (title) => {
      const response = await fetch('/api/notes?page=1&limit=100&archived=false', { credentials: 'include' });
      const body = await response.json();
      return body.notes.find((note) => note.title === title)?._id;
    }, TITLE);
    const external = await page.evaluate(async (id) => {
      const csrf = await (await fetch('/api/csrf-token', { credentials: 'include' })).json();
      const response = await fetch(`/api/notes/${id}`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf.csrfToken },
        body: JSON.stringify({ content: 'AENDERUNG VON AUSSEN' }),
      });
      return response.status;
    }, noteId);
    expect(external).toBe(200);

    // The focus refresh (throttled, no 60s wait) brings the new version in.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.locator('.note-modal-conflict')).toBeVisible({ timeout: 30000 });
    // The local edit is still in the textarea — nothing was overwritten.
    await expect(page.locator('.note-modal-content')).toContainText('lokaler Tippfehler');

    // Loading the server version asks before discarding local changes.
    await page.locator('.btn-conflict-load').click();
    await expect(page.locator('.confirm-dialog')).toBeVisible();
    await page.locator('.confirm-dialog .btn-confirm').click();
    await expect(page.locator('.note-modal-content')).toHaveValue('AENDERUNG VON AUSSEN', { timeout: 15000 });
    await expect(page.locator('.note-modal-conflict')).toHaveCount(0);
    await page.locator('.btn-modal-cancel').click();
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
  });

  // Audit 2026-09-12 (Top-30 Nr. 2): removing a friend used to keep
  // `sharedWith` intact, so an ex-friend kept read AND write access to notes
  // that were shared while the friendship existed.
  test('removing a friend revokes access to notes shared before', async ({ browser }) => {
    const TITLE = 'Geteilt vor dem Entfreunden';

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.fill('.note-modal-title', TITLE);
    await page.fill('.note-modal-content', 'Der Zugriff muss mit der Freundschaft enden');
    await page.click('.btn-modal-save');
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });

    // Share through the UI.
    await page.locator('[role="article"]', { hasText: TITLE }).click();
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.click('.btn-modal-collaborate');
    await expect(page.locator('.collaborate-modal')).toBeVisible();
    const shareButton = page.locator('.collaborate-modal .friend-item', { hasText: FRIEND.username }).locator('.btn-share');
    if (!(await shareButton.evaluate((el) => el.classList.contains('shared')))) {
      await shareButton.click();
    }
    await expect(shareButton).toHaveClass(/shared/, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.collaborate-modal')).toHaveCount(0);
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 15000 });

    const listBefore = await (await page.request.get('/api/notes?page=1&limit=50&archived=false')).json();
    const sharedNote = listBefore.notes.find((note) => note.title === TITLE);
    expect(sharedNote, 'the note must exist before unfriending').toBeTruthy();
    const sharedIds = sharedNote.sharedWith.map((user) => String(user._id ?? user));
    expect(sharedIds.length, 'the note must be shared before unfriending').toBe(1);
    const noteId = sharedNote._id;

    // The collaborator can see it right now.
    const friendContext = await browser.newContext();
    const friendPage = await friendContext.newPage();
    await friendPage.goto('/');
    await friendPage.fill('input[type="email"], form input[type="text"]', FRIEND.email);
    await friendPage.fill('form input[type="password"]', FRIEND.password);
    await friendPage.click('form button[type="submit"]');
    await expect(friendPage.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect(friendPage.locator('[role="article"]', { hasText: TITLE })).toBeVisible({ timeout: 20000 });

    // Remove the friend through the UI (sidebar -> friends -> remove -> confirm).
    await page.locator('.sidebar-item', { hasText: /Friends|Freunde/ }).click();
    await expect(page.locator('.friends-modal')).toBeVisible();
    await page.locator('.friends-modal .friend-item', { hasText: FRIEND.username }).locator('.btn-remove').click();
    await expect(page.locator('.confirm-dialog')).toBeVisible();
    await page.locator('.confirm-dialog .btn-confirm').click();
    await expect(page.locator('.friends-modal .friend-item', { hasText: FRIEND.username })).toHaveCount(0, { timeout: 15000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.friends-modal')).toHaveCount(0, { timeout: 15000 });

    // The share is gone server-side …
    const listAfter = await (await page.request.get('/api/notes?page=1&limit=50&archived=false')).json();
    const noteAfter = listAfter.notes.find((note) => note._id === noteId);
    expect(noteAfter.sharedWith, 'the ex-friend must be removed from sharedWith').toEqual([]);

    // … and the ex-friend really loses access (list + direct read).
    await friendPage.reload();
    await expect(friendPage.locator('.App')).toBeVisible({ timeout: 25000 });
    await expect(friendPage.locator('[role="article"]', { hasText: TITLE })).toHaveCount(0, { timeout: 20000 });
    const direct = await friendPage.request.get(`/api/notes/${noteId}`);
    expect(direct.status(), 'a direct read must not leak the note').toBe(404);
    await expect(friendPage.locator('body')).not.toContainText(errorBoundaryText);
    await friendContext.close();

    await expect(page.locator('body')).not.toContainText(errorBoundaryText);
  });

  // Audit 2026-09-12 (Top-30 Nr. 16): a reload, a session timeout or the
  // ErrorBoundary reset (`window.location.reload()`) used to cost everything
  // typed into the editor — the state lived only in React.
  test('an editor draft survives a reload and can be restored or discarded', async () => {
    const DRAFT_TEXT = `Entwurf nach Reload ${Date.now()}`;

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await page.locator('.note-modal-content').click();
    await page.keyboard.type(DRAFT_TEXT);

    // No save: the reload stands in for a crash, a tab close or a 401 logout.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });

    await page.click('.note-form-button');
    await expect(page.locator('.note-modal')).toBeVisible();
    await expect(page.locator('.note-modal-draft')).toBeVisible({ timeout: 10000 });
    await page.locator('.btn-draft-restore').click();
    await expect(page.locator('.note-modal-content')).toHaveValue(DRAFT_TEXT, { timeout: 10000 });
    await expect(page.locator('.note-modal-draft')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(errorBoundaryText);

    // Discard path: changed content, another reload, then refuse the draft.
    await page.locator('.note-modal-content').click();
    await page.keyboard.type(' + weitere Änderung');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator('.App')).toBeVisible({ timeout: 25000 });
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal-draft')).toBeVisible({ timeout: 10000 });
    await page.locator('.btn-draft-discard').click();
    await expect(page.locator('.note-modal-draft')).toHaveCount(0);
    await expect(page.locator('.note-modal-content')).toHaveValue('');

    // Nothing may be offered again after discarding.
    await page.locator('.btn-modal-cancel').click();
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await page.click('.note-form-button');
    await expect(page.locator('.note-modal-draft')).toHaveCount(0);
    await page.locator('.btn-modal-cancel').click();
    await expect(page.locator('.note-modal')).toHaveCount(0, { timeout: 20000 });
    await expectAppHealthy(page);
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
    // The queue can hold more than one toast, so match the specific one.
    await expect(
      page.locator('.toast', { hasText: /Password changed|Passwort geändert/ }).first()
    ).toBeVisible({ timeout: 15000 });
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
