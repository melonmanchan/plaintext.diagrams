import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { ascii, expect, seedDoc, shapes, test } from './helpers';

/* ---------- fixtures ---------- */

/** Two boxes and a labelled arrow — a scene with a stable ASCII golden. */
const SCENE = [
  { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: 'Web' },
  { type: 'box', id: 2, x: 22, y: 2, w: 12, h: 5, text: 'API' },
  { type: 'arrow', id: 3, x1: 13, y1: 4, x2: 22, y2: 4, box1: 1, box2: 2, text: 'call' },
];

const SCENE_ASCII = [
  '┌──────────┐        ┌──────────┐',
  '│          │        │          │',
  '│   Web    │ call ─▶│   API    │',
  '│          │        │          │',
  '└──────────┘        └──────────┘',
].join('\n');

/** Test seam: the capture array installed on window by installCopyStub. */
interface CopyCapture { __copied: string[] }

/**
 * Stub navigator.clipboard.writeText to capture copies into window.__copied.
 * Installed as an init script, so the page is re-navigated to pick it up.
 */
async function installCopyStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const copied: string[] = [];
    // Test seam: augment window with the capture array for later readback.
    const w = window as unknown as CopyCapture;
    w.__copied = copied;
    navigator.clipboard.writeText = (t: string): Promise<void> => {
      copied.push(t);
      return Promise.resolve();
    };
  });
  await page.goto('/');
  await page.waitForFunction(() => window.__app !== undefined);
}

async function copied(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // Test seam: installCopyStub installed this before navigation.
    const w = window as unknown as CopyCapture;
    return w.__copied;
  });
}

/* ---------- export preview ---------- */

test('Shift+E previews the exported diagram with size stats', async ({ page }) => {
  await seedDoc(page, SCENE, 10);
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#stats')).toHaveText(/^\d+ lines × \d+ cols · \d+ chars$/);
  await expect(page.locator('#stats')).toHaveText('5 lines × 32 cols · 164 chars');
  // The preview is exactly what the export surface renders — same bytes.
  const text = await ascii(page);
  await expect(page.locator('#out')).toHaveValue(text);
  expect(text).toBe(SCENE_ASCII);
});

test('the preview reports an empty canvas instead of size stats', async ({ page }) => {
  await seedDoc(page, []);
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#stats')).toHaveText('canvas is empty');
  await expect(page.locator('#out')).toHaveValue('');
});

test('Download .txt saves the export under the project name', async ({ page }) => {
  await page.addInitScript(() => { window.prompt = () => 'Flow Chart'; });
  await page.reload();
  await page.waitForFunction(() => window.__app !== undefined);
  await page.click('#proj-rename'); // distinctive name for the filename
  await seedDoc(page, SCENE, 10);
  await page.keyboard.press('Shift+E');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#download'),
  ]);
  expect(download.suggestedFilename()).toBe('Flow Chart.txt');
  // The file is the export plus a trailing newline.
  expect(await readFile(await download.path(), 'utf8')).toBe(SCENE_ASCII + '\n');
});

test('Copy JSON copies the interop shapes JSON and flashes', async ({ page }) => {
  await installCopyStub(page);
  await seedDoc(page, SCENE, 10);
  await page.keyboard.press('Shift+E');
  await page.click('#copy-json');
  await expect(page.locator('#copy-json')).toHaveText('Copied ✓');
  const [json] = await copied(page);
  expect(JSON.parse(json)).toEqual(await shapes(page));
});

/* ---------- help modal ---------- */

test('the help modal opens from ? and from the toolbar button', async ({ page }) => {
  await seedDoc(page, []);
  const help = page.locator('#helpmodal');
  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  await page.click('#help-close');
  await expect(help).toBeHidden();
  await page.click('#help');
  await expect(help).toBeVisible();
});

/* ---------- dismissal ---------- */

test('Escape and a backdrop mousedown close both modals', async ({ page }) => {
  await seedDoc(page, SCENE, 10);
  const modal = page.locator('#modal');
  const help = page.locator('#helpmodal');

  await page.keyboard.press('Shift+E');
  await expect(modal).toBeVisible();
  await page.keyboard.press('Escape'); // focus sits in #out — Escape still closes
  await expect(modal).toBeHidden();

  await page.keyboard.press('Shift+E');
  await modal.click({ position: { x: 6, y: 6 } }); // backdrop, outside the sheet
  await expect(modal).toBeHidden();

  await page.keyboard.press('?');
  await expect(help).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(help).toBeHidden();

  await page.keyboard.press('?');
  await help.click({ position: { x: 6, y: 6 } });
  await expect(help).toBeHidden();
});
