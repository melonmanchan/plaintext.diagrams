/**
 * Visual regression baselines for the canvas renderer.
 *
 * Baselines are compared against canonical PNGs in
 * `visual.spec.ts-snapshots/<name>.png`. Treat CI's Linux render as canonical;
 * canvas text rasterization can differ on macOS.
 *
 * These tests are opt-in: they run only with E2E_VISUAL=1, and their titles
 * carry a `@visual` tag so CI can grep them into a separate step.
 *
 * Regenerate locally with:
 *   E2E_VISUAL=1 bunx playwright test e2e/visual.spec.ts --update-snapshots
 */
import type { Page } from '@playwright/test';
import { canvasRect, cellPx, expect, seedDoc, test } from './helpers';
import type { Shape } from '../src/types';

test.skip(process.env.E2E_VISUAL !== '1', 'visual baselines are CI-generated');

const SHOT = { maxDiffPixelRatio: 0.01 };

/* ---------- fixtures ---------- */

/** The reference scene: three boxes, two attached arrows, one free text. */
const FLOW: Shape[] = [
  { type: 'box', id: 1, x: 4, y: 3, w: 14, h: 5, text: 'Browser' },
  { type: 'box', id: 2, x: 26, y: 3, w: 14, h: 5, text: 'Web\nServer' },
  { type: 'box', id: 3, x: 26, y: 13, w: 14, h: 5, text: 'Database' },
  { type: 'arrow', id: 4, x1: 0, y1: 0, x2: 0, y2: 0, box1: 1, box2: 2, text: 'GET' },
  { type: 'arrow', id: 5, x1: 0, y1: 0, x2: 0, y2: 0, box1: 2, box2: 3 },
  { type: 'text', id: 6, x: 4, y: 1, text: 'request flow' },
];

/**
 * Zoom with the real shortcut, then pan back to the world origin so every
 * screenshot frames the same cells regardless of zoom-pivot scrolling.
 */
async function zoomTo(page: Page, dir: 'in' | 'out', presses: number, label: string): Promise<void> {
  const key = dir === 'in' ? 'Control+=' : 'Control+-';
  for (let i = 0; i < presses; i++) await page.keyboard.press(key);
  await expect(page.locator('#zoom-reset')).toHaveText(label);
  await page.locator('#stage').evaluate((el) => { el.scrollLeft = 0; el.scrollTop = 0; });
}

/* ---------- highlights ---------- */

test('selection highlight @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 11, 5).x, cellPx(c, 11, 5).y);
  await expect(page.locator('#stage')).toHaveScreenshot('selection.png', SHOT);
});

test('hover highlight @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  const c = await canvasRect(page);
  await page.mouse.move(cellPx(c, 33, 5).x, cellPx(c, 33, 5).y);
  await expect(page.locator('#stage')).toHaveScreenshot('hover.png', SHOT);
});

/* ---------- glyph styles ---------- */

test('dashed arrow glyphs @visual', async ({ page }) => {
  await seedDoc(page, [
    { type: 'arrow', id: 1, x1: 3, y1: 3, x2: 30, y2: 3, box1: null, box2: null, style: 'dashed' },
    { type: 'arrow', id: 2, x1: 6, y1: 6, x2: 6, y2: 20, box1: null, box2: null, style: 'dashed' },
    { type: 'arrow', id: 3, x1: 14, y1: 6, x2: 34, y2: 18, box1: null, box2: null, style: 'dashed', heads: 'both' },
  ]);
  await expect(page.locator('#stage')).toHaveScreenshot('dashed-arrows.png', SHOT);
});

test('rounded box @visual', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 4, y: 3, w: 18, h: 6, text: 'rounded', style: 'round' },
    { type: 'box', id: 2, x: 28, y: 3, w: 18, h: 6, text: 'square' },
  ]);
  await expect(page.locator('#stage')).toHaveScreenshot('rounded-box.png', SHOT);
});

test('group tint and swimlanes @visual', async ({ page }) => {
  await seedDoc(page, [
    { type: 'group', id: 1, x: 3, y: 2, w: 44, h: 14, text: 'Sprint', lanes: ['Todo', 'Doing'] },
    { type: 'box', id: 2, x: 6, y: 6, w: 14, h: 5, text: 'spec' },
    { type: 'box', id: 3, x: 28, y: 6, w: 14, h: 5, text: 'build' },
  ]);
  await expect(page.locator('#stage')).toHaveScreenshot('group-lanes.png', SHOT);
});

/* ---------- mid-drag overlays ---------- */

test('snap guide mid-drag @visual', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: 'anchor' },
    { type: 'box', id: 2, x: 30, y: 8, w: 12, h: 5, text: 'moving' },
  ]);
  const c = await canvasRect(page);
  // Drop one row off box 1's top edge: the move snaps and draws the guide.
  await page.mouse.move(cellPx(c, 36, 10).x, cellPx(c, 36, 10).y);
  await page.mouse.down();
  await page.mouse.move(cellPx(c, 36, 5).x, cellPx(c, 36, 5).y, { steps: 8 });
  await expect(page.locator('#stage')).toHaveScreenshot('snap-guide.png', SHOT);
  await page.mouse.up();
});

test('marquee rect mid-drag @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  const c = await canvasRect(page);
  await page.mouse.move(cellPx(c, 1, 1).x, cellPx(c, 1, 1).y);
  await page.mouse.down();
  await page.mouse.move(cellPx(c, 44, 10).x, cellPx(c, 44, 10).y, { steps: 8 });
  await expect(page.locator('#stage')).toHaveScreenshot('marquee.png', SHOT);
  await page.mouse.up();
});

/* ---------- editor overlay across zoom levels ---------- */

test('editor overlay at zoom 0.64 @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  await zoomTo(page, 'out', 2, '64%');
  const c = await canvasRect(page);
  await page.mouse.dblclick(cellPx(c, 11, 5, 0.64).x, cellPx(c, 11, 5, 0.64).y);
  await expect(page.locator('.editor')).toBeVisible();
  await expect(page.locator('#stage')).toHaveScreenshot('editor-zoom-64.png', SHOT);
});

test('editor overlay at zoom 2 @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  await zoomTo(page, 'in', 4, '200%'); // 1.25 → 1.56 → 1.95 → clamped to 2
  const c = await canvasRect(page);
  await page.mouse.dblclick(cellPx(c, 11, 5, 2).x, cellPx(c, 11, 5, 2).y);
  await expect(page.locator('.editor')).toBeVisible();
  await expect(page.locator('#stage')).toHaveScreenshot('editor-zoom-200.png', SHOT);
});

/* ---------- whole scene, zoomed out ---------- */

test('full scene at zoom 0.5 @visual', async ({ page }) => {
  await seedDoc(page, FLOW);
  await zoomTo(page, 'out', 4, '50%'); // 0.8 → 0.64 → 0.51 → clamped to 0.5
  await expect(page.locator('#stage')).toHaveScreenshot('scene-zoom-50.png', SHOT);
});
