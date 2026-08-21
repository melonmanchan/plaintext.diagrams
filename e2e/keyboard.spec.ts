import { ascii, canvasRect, cellPx, drag, expect, seedDoc, shapes, test } from './helpers';
import type { ArrowShape, BoxShape, GroupShape } from '../src/types';

/** Slice of the window.__app test hook read by this spec. */
interface SelectionHook { selection: number[] }

/* ---------- tool shortcuts ---------- */

const TOOL_KEYS = [
  { key: 'v', tool: 'select' },
  { key: 'b', tool: 'box' },
  { key: 'a', tool: 'arrow' },
  { key: 't', tool: 'text' },
  { key: 'g', tool: 'group' },
] as const;

for (const { key, tool } of TOOL_KEYS) {
  test(`'${key}' activates the ${tool} tool`, async ({ page }) => {
    await seedDoc(page, []);
    await page.keyboard.press(key);
    await expect(page.locator('#tools button.active')).toHaveAttribute('data-tool', tool);
  });
}

/* ---------- Control+d style cycling ---------- */

test('Control+d rounds the corners of a selected box', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 8, 4).x, cellPx(c, 8, 4).y);
  await page.keyboard.press('Control+d');
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.style).toBe('round');
  expect(await ascii(page)).toBe([
    '╭──────────╮',
    '│          │',
    '│          │',
    '│          │',
    '╰──────────╯',
  ].join('\n'));
});

test('Control+d dashes a selected arrow and toggles back', async ({ page }) => {
  await seedDoc(page, [
    { type: 'arrow', id: 1, x1: 2, y1: 2, x2: 20, y2: 2, box1: null, box2: null },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 10, 2).x, cellPx(c, 10, 2).y); // select the arrow
  await page.keyboard.press('Control+d');
  let [a] = (await shapes(page)) as ArrowShape[];
  expect(a.style).toBe('dashed');
  expect(await ascii(page)).toBe('─── ─ ─ ─ ─ ─ ─ ──▶');
  await page.keyboard.press('Control+d');
  [a] = (await shapes(page)) as ArrowShape[];
  expect(a.style).toBeUndefined();
});

test('Control+d gives a selected group swimlanes with headers', async ({ page }) => {
  await seedDoc(page, [{ type: 'group', id: 1, x: 2, y: 2, w: 24, h: 8, text: '' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 10, 2).x, cellPx(c, 10, 2).y); // top border
  await page.keyboard.press('Control+d');
  const [g] = (await shapes(page)) as GroupShape[];
  expect(g.lanes).toEqual(['Lane 1', 'Lane 2']);
  expect(await ascii(page)).toBe([
    '╔═══════════╦══════════╗',
    '║ Lane 1    ║ Lane 2   ║',
    '╠═══════════╬══════════╣',
    '║           ║          ║',
    '║           ║          ║',
    '║           ║          ║',
    '║           ║          ║',
    '╚═══════════╩══════════╝',
  ].join('\n'));
});

/* ---------- Control+b arrowhead cycling ---------- */

test('Control+b cycles arrowheads end → both → start', async ({ page }) => {
  await seedDoc(page, [
    { type: 'arrow', id: 1, x1: 2, y1: 2, x2: 20, y2: 2, box1: null, box2: null },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 10, 2).x, cellPx(c, 10, 2).y);
  await page.keyboard.press('Control+b');
  let [a] = (await shapes(page)) as ArrowShape[];
  expect(a.heads).toBe('both');
  expect(await ascii(page)).toBe('◀─────────────────▶');
  await page.keyboard.press('Control+b');
  [a] = (await shapes(page)) as ArrowShape[];
  expect(a.heads).toBe('start');
  expect(await ascii(page)).toBe('◀──────────────────');
});

/* ---------- [ and ] endpoint pin cycling ---------- */

test('[ and ] walk endpoint pins auto → left → right → top → bottom → auto', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 2, x: 30, y: 2, w: 12, h: 5, text: '' },
    { type: 'arrow', id: 3, x1: 13, y1: 4, x2: 30, y2: 4, box1: 1, box2: 2 },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 22, 4).x, cellPx(c, 22, 4).y); // sole-select the arrow
  const arrow = async () => (await shapes(page)).find((s) => s.id === 3) as ArrowShape;

  await page.keyboard.press(']');
  expect((await arrow()).side2).toBe('left');
  await page.keyboard.press(']');
  expect((await arrow()).side2).toBe('right');
  await page.keyboard.press(']');
  expect((await arrow()).side2).toBe('top');

  await page.keyboard.press('[');
  expect((await arrow()).side1).toBe('left');
  for (const side of ['right', 'top', 'bottom'] as const) {
    await page.keyboard.press('[');
    expect((await arrow()).side1).toBe(side);
  }
  await page.keyboard.press('['); // bottom → back to auto
  expect((await arrow()).side1).toBeUndefined();
});

test('[ types into the label when the selection is a box', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 8, 4).x, cellPx(c, 8, 4).y);
  await page.keyboard.press('[');
  await page.keyboard.type('ok]');
  await page.keyboard.press('Enter');
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.text).toBe('[ok]');
});

/* ---------- undo / redo ---------- */

test('Control+z undoes a drawn box; Shift+z and y redo it', async ({ page }) => {
  await seedDoc(page, []);
  const c = await canvasRect(page);
  await page.keyboard.press('b');
  await drag(page, cellPx(c, 2, 2), cellPx(c, 13, 6));
  expect(await shapes(page)).toHaveLength(1);

  await page.keyboard.press('Control+z');
  expect(await shapes(page)).toHaveLength(0);
  expect(await ascii(page)).toBe('');

  await page.keyboard.press('Control+Shift+z');
  let [b] = (await shapes(page)) as BoxShape[];
  expect([b.x, b.y, b.w, b.h]).toEqual([2, 2, 12, 5]);

  await page.keyboard.press('Control+z');
  expect(await shapes(page)).toHaveLength(0);
  await page.keyboard.press('Control+y');
  [b] = (await shapes(page)) as BoxShape[];
  expect([b.x, b.y, b.w, b.h]).toEqual([2, 2, 12, 5]);
});

/* ---------- select all / delete ---------- */

test('Control+a selects every shape', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 6, h: 3, text: '' },
    { type: 'box', id: 2, x: 12, y: 2, w: 6, h: 3, text: '' },
    { type: 'arrow', id: 3, x1: 8, y1: 3, x2: 12, y2: 3, box1: 1, box2: 2 },
  ], 10);
  await page.keyboard.press('Control+a');
  const sel = await page.evaluate(() => {
    // Test seam: __app is declared `unknown`; the app guarantees this getter.
    const hook = window.__app as SelectionHook;
    return hook.selection;
  });
  expect(sel.sort()).toEqual([1, 2, 3]);
});

test('Delete removes the current selection', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 6, h: 3, text: '' },
    { type: 'box', id: 2, x: 12, y: 2, w: 6, h: 3, text: '' },
  ], 10);
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Delete');
  expect(await shapes(page)).toHaveLength(0);
  expect(await ascii(page)).toBe('');
});

/* ---------- zoom ---------- */

test('Control+= / Control+- / Control+0 zoom and reset', async ({ page }) => {
  await seedDoc(page, []);
  const reset = page.locator('#zoom-reset');
  await expect(reset).toHaveText('100%');
  await page.keyboard.press('Control+=');
  await expect(reset).toHaveText('125%');
  await page.keyboard.press('Control+=');
  await expect(reset).toHaveText('156%');
  await page.keyboard.press('Control+0');
  await expect(reset).toHaveText('100%');
  await page.keyboard.press('Control+-');
  await expect(reset).toHaveText('80%');
});

/* ---------- export / modals ---------- */

test("'e' copies the diagram and flashes the export button", async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  await page.keyboard.press('e');
  await expect(page.locator('#export')).toHaveText('Copied ✓');
});

test('Shift+e opens the export modal', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#modal')).toBeVisible();
  await expect(page.locator('#out')).toHaveValue(/┌─+┐/);
});

test('? opens the help modal and Escape closes it', async ({ page }) => {
  await seedDoc(page, []);
  await page.keyboard.press('?');
  await expect(page.locator('#helpmodal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('#helpmodal')).toBeHidden();
});
