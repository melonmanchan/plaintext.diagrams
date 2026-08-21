import type { Page } from '@playwright/test';
import { expect, test } from './helpers';
import { canvasRect, cellPx, drag, seedDoc, shapes } from './helpers';
import type { ArrowShape, BoxShape, GroupShape } from '../src/types';

/** Slice of the window.__app test hook read by this spec. */
interface SelectionHook { selection: number[] }

async function selection(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    // Test seam: __app is declared `unknown`; the app guarantees this getter.
    const hook = window.__app as SelectionHook;
    return hook.selection;
  });
}

test('dragging a box from its center moves it', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  const c = await canvasRect(page);
  await drag(page, cellPx(c, 8, 4), cellPx(c, 20, 10)); // dx=12, dy=6
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.x).toBe(14);
  expect(b.y).toBe(8);
  expect(await selection(page)).toEqual([1]);
});

test('dragging a group frame carries its contents', async ({ page }) => {
  await seedDoc(page, [
    { type: 'group', id: 1, x: 2, y: 2, w: 20, h: 8, text: '' },
    { type: 'box', id: 2, x: 5, y: 4, w: 8, h: 3, text: '' },
  ], 10);
  const c = await canvasRect(page);
  await drag(page, cellPx(c, 10, 2), cellPx(c, 16, 7)); // top border, dx=6 dy=5
  const [g, b] = (await shapes(page)) as [GroupShape, BoxShape];
  expect([g.x, g.y]).toEqual([8, 7]);
  expect([b.x, b.y]).toEqual([11, 9]); // box kept its offset inside the frame
});

test('dragging a box near another aligns it to the snap guide', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 2, x: 30, y: 8, w: 12, h: 5, text: '' },
  ], 10);
  const c = await canvasRect(page);
  // Raw drop lands at y=3, one row off box 1's top edge → snaps to y=2.
  await drag(page, cellPx(c, 36, 10), cellPx(c, 36, 5));
  const b = (await shapes(page)).find((s) => s.id === 2) as BoxShape;
  expect(b.y).toBe(2);
  expect(b.x).toBe(30); // no horizontal candidate within a cell
});

test('SE handle drag resizes the box', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 8, 4).x, cellPx(c, 8, 4).y); // select the box
  // Handles sit at the frame's outer corner in px, not on a cell center.
  const se = { x: c.left + (2 + 12) * 10, y: c.top + (2 + 5) * 18 };
  await drag(page, se, cellPx(c, 20, 10));
  const [b] = (await shapes(page)) as BoxShape[];
  expect([b.x, b.y, b.w, b.h]).toEqual([2, 2, 19, 9]);
});

test('resizing a lane group keeps contents in their lane slots', async ({ page }) => {
  await seedDoc(page, [
    { type: 'group', id: 1, x: 2, y: 2, w: 24, h: 10, text: '', lanes: ['A', 'B'] },
    { type: 'box', id: 2, x: 16, y: 5, w: 6, h: 3, text: '' }, // lane 1 (right)
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 6, 2).x, cellPx(c, 6, 2).y); // select via top border
  const se = { x: c.left + (2 + 24) * 10, y: c.top + (2 + 10) * 18 };
  await drag(page, se, cellPx(c, 19, 9)); // shrink to 18x8
  const [g, b] = (await shapes(page)) as [GroupShape, BoxShape];
  expect([g.w, g.h]).toEqual([18, 8]);
  // Lane separator moved to column 11; the box was pulled into lane 1's
  // shrunken interior (columns 12..18) instead of spilling over the frame.
  expect([b.x, b.y]).toEqual([13, 5]);
  expect(b.x + b.w - 1).toBeLessThanOrEqual(g.x + g.w - 2);
});

test('resize clamps to the label minimum size', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 18, h: 5, text: 'Wide Label' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 11, 4).x, cellPx(c, 11, 4).y);
  const se = { x: c.left + (2 + 18) * 10, y: c.top + (2 + 5) * 18 };
  await drag(page, se, cellPx(c, 4, 3)); // collapse far below the minimum
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.w).toBe(16); // label 10 + borders 2 + padding 4
  expect(b.h).toBe(3);
});

test('endpoint drag re-attaches with an edge pin; interior drop clears it', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 2, x: 30, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 3, x: 30, y: 10, w: 12, h: 5, text: '' },
    { type: 'arrow', id: 4, x1: 13, y1: 4, x2: 30, y2: 4, box1: 1, box2: 2 },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 20, 4).x, cellPx(c, 20, 4).y); // select the arrow line
  expect(await selection(page)).toEqual([4]);
  // Grab endpoint 2 at its resolved anchor and drop on box 3's left border.
  let a = (await shapes(page)).find((s) => s.id === 4) as ArrowShape;
  await drag(page, cellPx(c, a.x2, a.y2), cellPx(c, 30, 12));
  a = (await shapes(page)).find((s) => s.id === 4) as ArrowShape;
  expect(a.box2).toBe(3);
  expect(a.side2).toBe('left'); // border drop pins the side...
  expect(a.at2).toBe(2);        // ...at the exact dropped row
  // Re-grab and drop on box 3's interior: still attached, pin cleared.
  await drag(page, cellPx(c, a.x2, a.y2), cellPx(c, 35, 12));
  a = (await shapes(page)).find((s) => s.id === 4) as ArrowShape;
  expect(a.box2).toBe(3);
  expect(a.side2).toBeUndefined();
  expect(a.at2).toBeUndefined();
});

test('endpoint drag to empty canvas detaches the arrow', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 2, x: 30, y: 2, w: 12, h: 5, text: '' },
    { type: 'arrow', id: 3, x1: 13, y1: 4, x2: 30, y2: 4, box1: 1, box2: 2 },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 20, 4).x, cellPx(c, 20, 4).y);
  let a = (await shapes(page)).find((s) => s.id === 3) as ArrowShape;
  await drag(page, cellPx(c, a.x2, a.y2), cellPx(c, 22, 12));
  a = (await shapes(page)).find((s) => s.id === 3) as ArrowShape;
  expect(a.box2).toBeNull();
  expect(a.side2).toBeUndefined();
  expect([a.x2, a.y2]).toEqual([22, 12]);
  expect(a.box1).toBe(1); // untouched endpoint stays attached
});

test('marquee drag selects every shape it covers', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 6, h: 3, text: '' },
    { type: 'box', id: 2, x: 12, y: 2, w: 6, h: 3, text: '' },
  ], 10);
  const c = await canvasRect(page);
  await drag(page, cellPx(c, 0, 8), cellPx(c, 19, 1)); // empty start, sweep both
  expect((await selection(page)).sort()).toEqual([1, 2]);
});

test('shift-click adds to and removes from the selection', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 6, h: 3, text: '' },
    { type: 'box', id: 2, x: 12, y: 2, w: 6, h: 3, text: '' },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 4, 3).x, cellPx(c, 4, 3).y);
  expect(await selection(page)).toEqual([1]);
  await page.keyboard.down('Shift');
  await page.mouse.click(cellPx(c, 14, 3).x, cellPx(c, 14, 3).y);
  expect((await selection(page)).sort()).toEqual([1, 2]);
  await page.mouse.click(cellPx(c, 14, 3).x, cellPx(c, 14, 3).y); // toggle off
  await page.keyboard.up('Shift');
  expect(await selection(page)).toEqual([1]);
});

test('arrow keys nudge the selection by one cell', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 5, y: 5, w: 6, h: 3, text: '' }], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 8, 6).x, cellPx(c, 8, 6).y);
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowDown');
  const [b] = (await shapes(page)) as BoxShape[];
  expect([b.x, b.y]).toEqual([7, 6]);
});

test('Delete removes the selection and detaches its arrows', async ({ page }) => {
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
    { type: 'box', id: 2, x: 30, y: 2, w: 12, h: 5, text: '' },
    { type: 'arrow', id: 3, x1: 13, y1: 4, x2: 30, y2: 4, box1: 1, box2: 2 },
  ], 10);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 36, 4).x, cellPx(c, 36, 4).y); // select box 2
  await page.keyboard.press('Delete');
  const all = await shapes(page);
  expect(all.map((s) => s.id)).toEqual([1, 3]);
  const a = all.find((s) => s.id === 3) as ArrowShape;
  expect(a.box2).toBeNull(); // survivor arrow detached from the deleted box
  expect(a.box1).toBe(1);
  expect(await selection(page)).toEqual([]);
});

test('Control+click on empty canvas drops a quick box', async ({ page }) => {
  await seedDoc(page, []);
  const c = await canvasRect(page);
  await page.keyboard.down('Control');
  await page.mouse.click(cellPx(c, 20, 10).x, cellPx(c, 20, 10).y);
  await page.keyboard.up('Control');
  const all = (await shapes(page)) as BoxShape[];
  expect(all).toHaveLength(1);
  const [b] = all;
  expect([b.w, b.h]).toEqual([12, 5]);
  expect([b.x, b.y]).toEqual([14, 8]); // centered on the clicked cell
  expect(await selection(page)).toEqual([b.id]);
});

test('middle-button drag pans the stage', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' }], 10);
  const stage = page.locator('#stage');
  const before = await stage.evaluate((el) => el.scrollLeft);
  const c = await canvasRect(page);
  await page.mouse.move(c.left + 500, c.top + 300);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(c.left + 350, c.top + 300, { steps: 5 }); // drag content left
  const after = await stage.evaluate((el) => el.scrollLeft);
  await page.mouse.up({ button: 'middle' });
  expect(after - before).toBe(150);
});
