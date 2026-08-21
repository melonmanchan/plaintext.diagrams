import type { Page } from '@playwright/test';
import { expect, test } from './helpers';
import { ascii, canvasRect, cellPx, drag, shapes } from './helpers';
import type { BoxShape } from '../src/types';

/** Slice of the window.__app test hook read by this spec. */
interface ProjectsHook { projects: { id: string; name: string }[] }

async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await page.waitForFunction(() => window.__app !== undefined);
}

/**
 * Stub window.prompt/confirm (the project bar calls them synchronously).
 * Installed as an init script, so the page is re-navigated to pick it up.
 */
async function stubDialogs(
  page: Page,
  stub: { prompt?: string; confirm?: boolean },
): Promise<void> {
  await page.addInitScript((s) => {
    if (s.prompt !== undefined) window.prompt = () => s.prompt as string;
    if (s.confirm !== undefined) window.confirm = () => s.confirm as boolean;
  }, stub);
  await reloadApp(page);
}

async function projects(page: Page): Promise<{ id: string; name: string }[]> {
  return page.evaluate(() => {
    // Test seam: __app is declared `unknown`; the app guarantees this getter.
    return (window.__app as ProjectsHook).projects;
  });
}

async function storageKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => Object.keys(localStorage));
}

/** Draw a box with the mouse: 8x2 cells at (2,2) unless told otherwise. */
async function drawBox(page: Page, x1 = 2, y1 = 2, x2 = 9, y2 = 3): Promise<void> {
  const c = await canvasRect(page);
  await page.keyboard.press('b');
  await drag(page, cellPx(c, x1, y1), cellPx(c, x2, y2));
  await page.keyboard.press('Escape');
}

/* ---------- doc persistence ---------- */

test('a drawn box is restored after a reload', async ({ page }) => {
  await drawBox(page, 2, 2, 13, 4);
  const drawn = await ascii(page);
  await reloadApp(page);
  expect((await shapes(page)).length).toBe(7); // demo (6) + drawn box
  expect(await ascii(page)).toBe(drawn);
});

test('undo history survives a reload', async ({ page }) => {
  const before = await ascii(page);
  await drawBox(page, 2, 2, 13, 4);
  await reloadApp(page);
  await page.keyboard.press('Control+z'); // undoes the pre-reload draw
  expect((await shapes(page)).length).toBe(6);
  expect(await ascii(page)).toBe(before);
});

/* ---------- project bar ---------- */

test('a new project starts empty and leaves the old doc untouched', async ({ page }) => {
  const firstId = await page.locator('#project').inputValue();
  await stubDialogs(page, { prompt: 'Second' });
  await page.click('#proj-new');
  expect(await shapes(page)).toEqual([]);
  expect((await projects(page)).map((p) => p.name)).toEqual(['Untitled', 'Second']);
  await expect(page).toHaveTitle('Second — plaintext.diagrams');
  await drawBox(page);
  expect((await shapes(page)).length).toBe(1);
  const firstDoc = await page.evaluate(
    (id) => JSON.parse(localStorage.getItem('ptd:doc:' + id)!) as { shapes: unknown[] },
    firstId,
  );
  expect(firstDoc.shapes.length).toBe(6);
});

test('renaming a project updates the title and the select', async ({ page }) => {
  await stubDialogs(page, { prompt: 'Rocket Plan' });
  await page.click('#proj-rename');
  await expect(page).toHaveTitle('Rocket Plan — plaintext.diagrams');
  await expect(page.locator('#project option:checked')).toHaveText('Rocket Plan');
  await reloadApp(page);
  await expect(page).toHaveTitle('Rocket Plan — plaintext.diagrams');
});

test('deleting a project drops its storage keys and falls back', async ({ page }) => {
  const firstId = await page.locator('#project').inputValue();
  await stubDialogs(page, { prompt: 'Temp', confirm: true });
  await page.click('#proj-new');
  await drawBox(page); // save() writes the doc + history keys
  const tempId = await page.locator('#project').inputValue();
  expect(await storageKeys(page)).toEqual(
    expect.arrayContaining(['ptd:doc:' + tempId, 'ptd:hist:' + tempId]),
  );
  await page.click('#proj-delete');
  const keys = await storageKeys(page);
  expect(keys).not.toContain('ptd:doc:' + tempId);
  expect(keys).not.toContain('ptd:hist:' + tempId);
  expect((await projects(page)).map((p) => p.id)).toEqual([firstId]);
  expect((await shapes(page)).length).toBe(6); // back on the demo doc
});

test('switching projects via the select swaps docs', async ({ page }) => {
  const firstId = await page.locator('#project').inputValue();
  const demoAscii = await ascii(page);
  await stubDialogs(page, { prompt: 'B side' });
  await page.click('#proj-new');
  await drawBox(page);
  const secondId = await page.locator('#project').inputValue();
  await page.selectOption('#project', firstId);
  expect(await ascii(page)).toBe(demoAscii);
  await page.selectOption('#project', secondId);
  expect((await shapes(page)).length).toBe(1);
  await expect(page).toHaveTitle('B side — plaintext.diagrams');
});

/* ---------- boot resilience ---------- */

test('legacy vibedraw:* storage migrates to ptd:* on boot', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      'vibedraw:index',
      JSON.stringify({ projects: [{ id: 'leg1', name: 'Legacy Proj' }], current: 'leg1' }),
    );
    localStorage.setItem(
      'vibedraw:doc:leg1',
      JSON.stringify({ seq: 2, shapes: [{ type: 'box', id: 1, x: 2, y: 2, w: 10, h: 4, text: 'Legacy' }] }),
    );
  });
  await reloadApp(page);
  const keys = await storageKeys(page);
  expect(keys).toEqual(expect.arrayContaining(['ptd:index', 'ptd:doc:leg1']));
  expect(keys.filter((k) => k.startsWith('vibedraw:'))).toEqual([]);
  expect((await projects(page)).map((p) => p.name)).toEqual(['Legacy Proj']);
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.type).toBe('box');
  expect(b.text).toBe('Legacy');
});

test('a corrupted ptd:index boots the demo without throwing', async ({ page }) => {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem('ptd:index', '{not json');
  });
  await reloadApp(page);
  expect(errors).toEqual([]);
  expect((await shapes(page)).length).toBe(6);
  expect((await projects(page)).map((p) => p.name)).toEqual(['Untitled']);
});
