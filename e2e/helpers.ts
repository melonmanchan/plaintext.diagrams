import { test as base, expect as baseExpect, type Page } from '@playwright/test';
import type { DocState, Shape } from '../src/types';

/** Slice of the window.__app test hook used by the helpers. */
interface AppHook {
  doc: DocState;
  exportAscii(): string;
}

export interface AppPage { page: Page; canvas: { left: number; top: number } }

/** goto '/', clear storage, reload, wait for __app. */
export async function freshApp(page: Page): Promise<void> {
  await page.goto('/');
  await page.evaluate(() => localStorage.clear());
  await page.goto('/');
  await page.waitForFunction(() => window.__app !== undefined);
}

export async function canvasRect(page: Page): Promise<{ left: number; top: number }> {
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('#canvas has no bounding box');
  return { left: box.x, top: box.y };
}

/** Pixel center of cell (cx, cy), offset by the canvas rect. CW=10, CH=18. */
export function cellPx(
  c: { left: number; top: number },
  cx: number,
  cy: number,
  zoom = 1,
): { x: number; y: number } {
  return { x: c.left + (cx * 10 + 5) * zoom, y: c.top + (cy * 18 + 9) * zoom };
}

/** __app.doc = { seq, shapes }; the setter also clears selection and renders. */
export async function seedDoc(page: Page, shapes: unknown[], seq = 1): Promise<void> {
  await page.evaluate(
    ({ shapes, seq }) => {
      // Test seam: __app is declared `unknown`; seed data is trusted test input.
      (window.__app as AppHook).doc = { seq, shapes: shapes as Shape[] };
    },
    { shapes, seq },
  );
}

export async function ascii(page: Page): Promise<string> {
  return page.evaluate(() => (window.__app as AppHook).exportAscii());
}

export async function shapes(page: Page): Promise<Shape[]> {
  return page.evaluate(() => (window.__app as AppHook).doc.shapes);
}

export async function drag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

export async function rightClick(page: Page, at: { x: number; y: number }): Promise<void> {
  await page.mouse.click(at.x, at.y, { button: 'right' });
}

/** Synthetic ClipboardEvent paste after a mousemove onto the canvas center. */
export async function pasteText(page: Page, text: string): Promise<void> {
  const box = await page.locator('#canvas').boundingBox();
  if (!box) throw new Error('#canvas has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate((t) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
  }, text);
}

export const test = base.extend<{ app: AppPage }>({
  page: async ({ page }, use) => {
    await freshApp(page);
    await use(page);
  },
  app: async ({ page }, use) => {
    await use({ page, canvas: await canvasRect(page) });
  },
});

export const expect = baseExpect;
