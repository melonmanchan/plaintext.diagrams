import { ascii, canvasRect, cellPx, drag, expect, test } from "./helpers";

test("boots the demo doc and draws a box with the mouse", async ({ page }) => {
	const c = await canvasRect(page);
	await page.keyboard.press("b"); // box tool
	await drag(page, cellPx(c, 2, 2), cellPx(c, 13, 4)); // 12x3 box
	await page.keyboard.press("Escape");
	expect(await ascii(page)).toBe(
		[
			"    GET /index.html",
			"┌──────────┐",
			"│          │                          ┌────────────────┐",
			"└──────────┴───────┐                  │                │",
			"    │              │                  │      Web       │",
			"    │   Browser    │─────────────────▶│     Server     │",
			"    │              │                  │                │",
			"    └──────────────┘                  │                │",
			"                                      └────────────────┘",
			"                                               │",
			"                                               │",
			"                                               │",
			"                                               │",
			"                                               │",
			"                                               ▼",
			"                                       ┌──────────────┐",
			"                                       │              │",
			"                                       │   Database   │",
			"                                       │              │",
			"                                       └──────────────┘",
		].join("\n"),
	);
});

test("top toolbar scrolls horizontally on narrow screens", async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 640 });
	const toolbar = page.locator("#toolbar");
	const metrics = await toolbar.evaluate((el) => ({
		clientHeight: el.clientHeight,
		clientWidth: el.clientWidth,
		overflowX: getComputedStyle(el).overflowX,
		scrollWidth: el.scrollWidth,
	}));
	expect(metrics.overflowX).toBe("auto");
	expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
	expect(metrics.clientHeight).toBeLessThan(72);

	await toolbar.evaluate((el) => {
		el.scrollLeft = 0;
	});
	const box = await toolbar.boundingBox();
	if (!box) throw new Error("#toolbar has no bounding box");
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.wheel(0, 240);
	await expect
		.poll(() => toolbar.evaluate((el) => el.scrollLeft))
		.toBeGreaterThan(0);
	await page.mouse.wheel(0, -240);
	await expect.poll(() => toolbar.evaluate((el) => el.scrollLeft)).toBe(0);

	await toolbar.evaluate((el) => {
		el.scrollLeft = el.scrollWidth;
	});
	const exportIsReachable = await page.locator("#export").evaluate((el) => {
		const r = el.getBoundingClientRect();
		return r.left >= 0 && r.right <= window.innerWidth;
	});
	expect(exportIsReachable).toBe(true);
});
