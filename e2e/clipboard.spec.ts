import {
  ascii, canvasRect, cellPx, copied, expect, installCopyStub,
  pasteAt, pasteText, seedDoc, shapes, test,
} from './helpers';
import type { ArrowShape, BoxShape, TextShape } from '../src/types';

/* ---------- paste: ASCII / Unicode diagrams ---------- */

test('pasting an ASCII diagram anchors it at the cursor cell', async ({ page }) => {
  await seedDoc(page, []);
  const c = await canvasRect(page);
  await pasteAt(page, c, 10, 5, [
    '+------+',
    '|      |',
    '+------+',
  ].join('\n'));
  const [b] = (await shapes(page)) as BoxShape[];
  expect(b.type).toBe('box');
  expect([b.x, b.y, b.w, b.h]).toEqual([10, 5, 8, 3]);
  expect(await ascii(page)).toBe([
    '┌──────┐',
    '│      │',
    '└──────┘',
  ].join('\n'));
});

test('pasting a Unicode diagram parses boxes, labels, and pinned arrows', async ({ page }) => {
  await seedDoc(page, []);
  const diagram = [
    '┌──────┐',
    '│  DB  │',
    '└──────┘',
    '   │',
    '   ▼',
    '┌──────┐',
    '│ Disk │',
    '└──────┘',
  ].join('\n');
  await pasteText(page, diagram);
  const all = await shapes(page);
  const boxes = all.filter((s): s is BoxShape => s.type === 'box');
  const [arrow] = all.filter((s): s is ArrowShape => s.type === 'arrow');
  expect(boxes.map((b) => b.text)).toEqual(['DB', 'Disk']);
  expect(arrow.box1).toBe(boxes[0].id);
  expect(arrow.box2).toBe(boxes[1].id);
  expect(arrow.side1).toBe('bottom');
  expect(arrow.side2).toBe('top');
  expect(await ascii(page)).toBe(diagram);
});

/* ---------- paste: shapes JSON ---------- */

test('pasting shapes JSON keeps dashed style and side pins', async ({ page }) => {
  await seedDoc(page, []);
  const c = await canvasRect(page);
  await pasteAt(page, c, 2, 2, JSON.stringify([
    { type: 'box', id: 1, x: 2, y: 2, w: 8, h: 3, text: 'A' },
    { type: 'box', id: 2, x: 20, y: 2, w: 8, h: 3, text: 'B' },
    { type: 'arrow', id: 3, x1: 10, y1: 3, x2: 20, y2: 3, box1: 1, box2: 2, style: 'dashed', side1: 'right', side2: 'left' },
  ]));
  const all = await shapes(page);
  const boxes = all.filter((s): s is BoxShape => s.type === 'box');
  const [arrow] = all.filter((s): s is ArrowShape => s.type === 'arrow');
  expect(arrow.style).toBe('dashed');
  expect(arrow.side1).toBe('right');
  expect(arrow.side2).toBe('left');
  expect(arrow.box1).toBe(boxes[0].id);
  expect(arrow.box2).toBe(boxes[1].id);
  expect(await ascii(page)).toBe([
    '┌──────┐          ┌──────┐',
    '│  A   │── ─ ─ ──▶│  B   │',
    '└──────┘          └──────┘',
  ].join('\n'));
});

test('pasting JSON-looking garbage reports the error and leaves the doc unchanged', async ({ page }) => {
  await seedDoc(page, [{ type: 'box', id: 1, x: 2, y: 2, w: 8, h: 3, text: 'KEEP' }]);
  const before = await ascii(page);
  await pasteText(page, '{ this is not json');
  await expect(page.locator('#hint')).toContainText('JSON import failed');
  expect(await shapes(page)).toHaveLength(1);
  expect(await ascii(page)).toBe(before);
});

test('pasting plain prose becomes text shapes', async ({ page }) => {
  await seedDoc(page, []);
  await pasteText(page, 'hello world\nsecond line');
  const texts = (await shapes(page)) as TextShape[];
  expect(texts.map((t) => t.type)).toEqual(['text', 'text']);
  expect(texts.map((t) => t.text)).toEqual(['hello world', 'second line']);
});

/* ---------- copy: selection, whole doc, JSON ---------- */

test('Control+c copies only the selected shapes as text', async ({ page }) => {
  await installCopyStub(page);
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 8, h: 3, text: 'AA' },
    { type: 'box', id: 2, x: 20, y: 2, w: 8, h: 3, text: 'BB' },
  ]);
  const c = await canvasRect(page);
  await page.mouse.click(cellPx(c, 5, 3).x, cellPx(c, 5, 3).y); // select AA
  await page.keyboard.press('Control+c');
  await expect(page.locator('#export')).toHaveText('Copied selection ✓');
  const [text] = await copied(page);
  expect(text).toBe([
    '┌──────┐',
    '│  AA  │',
    '└──────┘',
  ].join('\n'));
  expect(text).not.toContain('BB');
});

test("'e' copies the whole doc as text", async ({ page }) => {
  await installCopyStub(page);
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 8, h: 3, text: 'AA' },
    { type: 'box', id: 2, x: 20, y: 2, w: 8, h: 3, text: 'BB' },
  ]);
  await page.keyboard.press('e');
  await expect(page.locator('#export')).toHaveText('Copied ✓');
  const [text] = await copied(page);
  expect(text).toBe(await ascii(page));
});

test('Copy JSON output re-imports as an identical diagram', async ({ page }) => {
  await installCopyStub(page);
  await seedDoc(page, [
    { type: 'box', id: 1, x: 2, y: 2, w: 8, h: 3, text: 'A' },
    { type: 'box', id: 2, x: 20, y: 2, w: 8, h: 3, text: 'B' },
    { type: 'arrow', id: 3, x1: 10, y1: 3, x2: 20, y2: 3, box1: 1, box2: 2, style: 'dashed', side1: 'right', side2: 'left' },
  ]);
  const before = await ascii(page);
  await page.keyboard.press('Shift+E');
  await expect(page.locator('#modal')).toBeVisible();
  await page.locator('#copy-json').click();
  await expect(page.locator('#copy-json')).toHaveText('Copied ✓');
  const [json] = await copied(page);
  expect(json).toContain('"style":"dashed"');
  await page.keyboard.press('Escape');
  await expect(page.locator('#modal')).toBeHidden();

  await seedDoc(page, []);
  expect(await ascii(page)).toBe('');
  const c = await canvasRect(page);
  await pasteAt(page, c, 2, 2, json);
  expect(await ascii(page)).toBe(before);
});
