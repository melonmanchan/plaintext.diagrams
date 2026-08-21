import {
  canvasRect, cellPx, expect, rightClick, seedDoc, selection, shapes, test,
} from './helpers';
import type { ArrowShape, BoxShape, Shape } from '../src/types';

const TWO_BOXES: Shape[] = [
  { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
  { type: 'box', id: 2, x: 30, y: 10, w: 12, h: 5, text: '' },
];

const BOXES_AND_ARROW: Shape[] = [
  { type: 'box', id: 1, x: 2, y: 2, w: 12, h: 5, text: '' },
  { type: 'box', id: 2, x: 30, y: 2, w: 12, h: 5, text: '' },
  { type: 'arrow', id: 3, x1: 13, y1: 4, x2: 30, y2: 4, box1: 1, box2: 2 },
];

test('right-click on an arrow cycles its heads end → both → start → end', async ({ page }) => {
  await seedDoc(page, BOXES_AND_ARROW);
  const c = await canvasRect(page);
  const onLine = cellPx(c, 20, 4);
  const heads = async () =>
    ((await shapes(page)).find((s) => s.id === 3) as ArrowShape).heads;

  await rightClick(page, onLine);
  expect(await heads()).toBe('both');
  expect(await selection(page)).toEqual([3]);
  await rightClick(page, onLine);
  expect(await heads()).toBe('start');
  await rightClick(page, onLine);
  expect(await heads()).toBe('end');
});

test('right-click box then right-click a second box connects them', async ({ page }) => {
  await seedDoc(page, TWO_BOXES);
  const c = await canvasRect(page);
  await rightClick(page, cellPx(c, 8, 4));   // box 1 interior
  await rightClick(page, cellPx(c, 36, 12)); // box 2 interior
  const all = await shapes(page);
  expect(all).toHaveLength(3);
  const a = all[2] as ArrowShape;
  expect(a.type).toBe('arrow');
  expect(a.box1).toBe(1);
  expect(a.box2).toBe(2);
  expect(await selection(page)).toEqual([a.id]);
});

test('interior right-clicks leave both endpoint pins auto', async ({ page }) => {
  await seedDoc(page, TWO_BOXES);
  const c = await canvasRect(page);
  await rightClick(page, cellPx(c, 8, 4));   // interior — no side to pin
  await rightClick(page, cellPx(c, 36, 12)); // interior — no side to pin
  const a = (await shapes(page))[2] as ArrowShape;
  expect(a.side1).toBeUndefined();
  expect(a.at1).toBeUndefined();
  expect(a.side2).toBeUndefined();
  expect(a.at2).toBeUndefined();
});

test('edge right-clicks pin the clicked side and exact offset', async ({ page }) => {
  await seedDoc(page, TWO_BOXES);
  const c = await canvasRect(page);
  await rightClick(page, cellPx(c, 13, 4));  // box 1 right border, row 2 of the box
  await rightClick(page, cellPx(c, 30, 12)); // box 2 left border, row 2 of the box
  const a = (await shapes(page))[2] as ArrowShape;
  expect(a.box1).toBe(1);
  expect(a.box2).toBe(2);
  expect(a.side1).toBe('right');
  expect(a.at1).toBe(2);
  expect(a.side2).toBe('left');
  expect(a.at2).toBe(2);
});

test('right-click box then empty space drops a connected box with the editor open', async ({ page }) => {
  await seedDoc(page, [TWO_BOXES[0]]);
  const c = await canvasRect(page);
  await rightClick(page, cellPx(c, 8, 4));   // arm box 1
  await rightClick(page, cellPx(c, 30, 12)); // empty canvas
  await expect(page.locator('.editor')).toBeVisible();
  await page.keyboard.type('API');
  await page.keyboard.press('Enter');
  const all = await shapes(page);
  expect(all).toHaveLength(3);
  const b = all[1] as BoxShape;
  const a = all[2] as ArrowShape;
  expect(b.type).toBe('box');
  expect(b.text).toBe('API');
  expect([b.x, b.y, b.w, b.h]).toEqual([24, 10, 12, 5]); // 12x5, centered on the click
  expect(a.box1).toBe(1);
  expect(a.box2).toBe(b.id);
  expect(await selection(page)).toEqual([b.id]);
});

test('right-click on empty space connects from the sole selected box', async ({ page }) => {
  await seedDoc(page, [TWO_BOXES[0]]);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 8, 4).x, cellPx(c, 8, 4).y); // select box 1
  expect(await selection(page)).toEqual([1]);
  await rightClick(page, cellPx(c, 30, 12)); // empty canvas, nothing armed
  await expect(page.locator('.editor')).toBeVisible();
  await page.keyboard.press('Escape'); // keep the box, skip the label
  const all = await shapes(page);
  expect(all).toHaveLength(3);
  const a = all[2] as ArrowShape;
  expect(a.box1).toBe(1);
  expect(a.box2).toBe(all[1].id);
  expect(a.side1).toBeUndefined(); // selection-sourced connect never pins
  expect(a.at1).toBeUndefined();
});

test('right-click on empty space with nothing armed or selected is a no-op', async ({ page }) => {
  await seedDoc(page, [TWO_BOXES[0]]);
  const c = await canvasRect(page);
  await rightClick(page, cellPx(c, 30, 12));
  expect(await shapes(page)).toHaveLength(1);
  await expect(page.locator('.editor')).toHaveCount(0);
  expect(await selection(page)).toEqual([]);
});

test('pending-connect hint appears after the first right-click and resets after cancel', async ({ page }) => {
  await seedDoc(page, BOXES_AND_ARROW);
  const c = await canvasRect(page);
  const hint = page.locator('#hint');

  await rightClick(page, cellPx(c, 8, 4)); // arm box 1
  await expect(hint).toContainText('right-click another box to connect it to "this box"');
  await page.mouse.move(cellPx(c, 20, 12).x, cellPx(c, 20, 12).y);
  await expect(hint).toContainText('right-click elsewhere to cancel');

  await rightClick(page, cellPx(c, 20, 4)); // arrow hit cancels the pending source
  await page.mouse.move(cellPx(c, 22, 12).x, cellPx(c, 22, 12).y);
  await expect(hint).not.toContainText('cancel');
  await expect(hint).not.toContainText('connect');
  expect(await shapes(page)).toHaveLength(3); // no new shapes appeared
});
