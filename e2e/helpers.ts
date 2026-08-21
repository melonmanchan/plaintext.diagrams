import {
	test as base,
	expect as baseExpect,
	type Page,
} from "@playwright/test";
import type { DocState, Project, Shape } from "../src/types";

/** Slice of the window.__app test hook used by the specs. */
interface AppHook {
	doc: DocState;
	selection: number[];
	projects: Project[];
	exportAscii(): string;
	shareLink(): Promise<string>;
}

/** Test seam: the capture array installed on window by installCopyStub. */
interface CopyCapture {
	__copied: string[];
}

async function waitForApp(page: Page): Promise<void> {
	await page.waitForFunction(() => window.__app !== undefined);
}

/** goto '/', clear storage, reload, wait for __app. */
async function freshApp(page: Page): Promise<void> {
	await page.goto("/");
	await page.evaluate(() => localStorage.clear());
	await page.goto("/");
	await waitForApp(page);
}

export async function reloadApp(page: Page): Promise<void> {
	await page.reload();
	await waitForApp(page);
}

/** Open a URL in a SECOND browser context (cold start, isolated storage). */
export async function openFresh(
	page: Page,
	url: string,
	/** Runs before the navigation — the seam for pre-goto listeners. */
	before?: (opened: Page) => void,
): Promise<Page> {
	const ctx = await page.context().browser()?.newContext();
	const opened = await ctx.newPage();
	before?.(opened);
	await opened.goto(url);
	await waitForApp(opened);
	return opened;
}

export async function canvasRect(
	page: Page,
): Promise<{ left: number; top: number }> {
	const box = await page.locator("#canvas").boundingBox();
	if (!box) throw new Error("#canvas has no bounding box");
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

/**
 * Pixel of cell (cx, cy)'s top-left grid intersection — a shape's OUTER
 * corner, where resize handles sit (they are not on a cell center).
 */
export function cellCornerPx(
	c: { left: number; top: number },
	cx: number,
	cy: number,
	zoom = 1,
): { x: number; y: number } {
	return { x: c.left + cx * 10 * zoom, y: c.top + cy * 18 * zoom };
}

/**
 * __app.doc = { seq, shapes }; the setter also clears selection and renders.
 * seq defaults to 10 so ids minted after seeding never collide with fixture
 * ids, which start at 1; pass a seq only when its exact value matters.
 */
export async function seedDoc(
	page: Page,
	shapes: Shape[],
	seq = 10,
): Promise<void> {
	await page.evaluate(
		({ shapes, seq }) => {
			// Test seam: __app is declared `unknown`; seed data is trusted test input.
			(window.__app as AppHook).doc = { seq, shapes };
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

export async function selection(page: Page): Promise<number[]> {
	return page.evaluate(() => (window.__app as AppHook).selection);
}

export async function projects(page: Page): Promise<Project[]> {
	return page.evaluate(() => (window.__app as AppHook).projects);
}

/** Full share URL for the current project. */
export async function shareLink(page: Page): Promise<string> {
	return page.evaluate(() => (window.__app as AppHook).shareLink());
}

/** Wait for a late project count — the #s= import lands asynchronously. */
export async function waitForProjects(
	page: Page,
	count: number,
): Promise<void> {
	await page.waitForFunction(
		(want) => (window.__app as AppHook | undefined)?.projects.length === want,
		count,
	);
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

export async function rightClick(
	page: Page,
	at: { x: number; y: number },
): Promise<void> {
	await page.mouse.click(at.x, at.y, { button: "right" });
}

/**
 * Synthetic bubbling ClipboardEvent paste after a mousemove onto cell
 * (cx, cy) — real paste events bubble from document to the window listener,
 * and the drop cell is the one under the cursor.
 */
export async function pasteAt(
	page: Page,
	c: { left: number; top: number },
	cx: number,
	cy: number,
	text: string,
): Promise<void> {
	const p = cellPx(c, cx, cy);
	await page.mouse.move(p.x, p.y);
	await page.evaluate((t) => {
		const dt = new DataTransfer();
		dt.setData("text/plain", t);
		document.dispatchEvent(
			new ClipboardEvent("paste", { clipboardData: dt, bubbles: true }),
		);
	}, text);
}

/**
 * Paste at cell (12, 8): a cell that is always on-screen, since the canvas
 * is far larger than the viewport and its center is off-screen.
 */
export async function pasteText(page: Page, text: string): Promise<void> {
	await pasteAt(page, await canvasRect(page), 12, 8, text);
}

/**
 * Stub navigator.clipboard.writeText to capture copies into window.__copied.
 * Installed as an init script, so the page is re-navigated to pick it up.
 */
export async function installCopyStub(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const captured: string[] = [];
		// Test seam: augment window with the capture array for later readback.
		const w = window as unknown as CopyCapture;
		w.__copied = captured;
		navigator.clipboard.writeText = (t: string): Promise<void> => {
			captured.push(t);
			return Promise.resolve();
		};
	});
	await page.goto("/");
	await waitForApp(page);
}

export async function copied(page: Page): Promise<string[]> {
	return page.evaluate(() => {
		// Test seam: installCopyStub installed this before navigation.
		const w = window as unknown as CopyCapture;
		return w.__copied;
	});
}

/**
 * Stub window.prompt/confirm (the project bar calls them synchronously).
 * Installed as an init script, so the page is re-navigated to pick it up.
 */
export async function stubDialogs(
	page: Page,
	stub: { prompt?: string; confirm?: boolean },
): Promise<void> {
	await page.addInitScript((s) => {
		if (s.prompt !== undefined) window.prompt = () => s.prompt as string;
		if (s.confirm !== undefined) window.confirm = () => s.confirm as boolean;
	}, stub);
	await reloadApp(page);
}

export const test = base.extend({
	page: async ({ page }, use) => {
		await freshApp(page);
		await use(page);
	},
});

export const expect = baseExpect;
