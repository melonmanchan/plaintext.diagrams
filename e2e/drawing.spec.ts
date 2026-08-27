import type { ArrowShape, BoxShape, GroupShape } from "../src/types";
import {
	ascii,
	canvasRect,
	cellPx,
	drag,
	expect,
	seedDoc,
	shapes,
	test,
} from "./helpers";

test("box tool drag creates a box and typing labels it", async ({ page }) => {
	await seedDoc(page, []);
	const c = await canvasRect(page);
	await page.keyboard.press("b");
	await drag(page, cellPx(c, 2, 2), cellPx(c, 13, 6)); // 12x5 box
	await page.keyboard.type("Data");
	await page.keyboard.press("Enter");
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.type).toBe("box");
	expect(b.text).toBe("Data");
	expect(await ascii(page)).toBe(
		[
			"┌──────────┐",
			"│          │",
			"│   Data   │",
			"│          │",
			"└──────────┘",
		].join("\n"),
	);
});

test("typing a long label grows the box live and commits widened", async ({
	page,
}) => {
	await seedDoc(page, [
		{ type: "box", id: 1, x: 2, y: 2, w: 3, h: 3, text: "" },
	]);
	const c = await canvasRect(page);
	await page.mouse.click(cellPx(c, 3, 3).x, cellPx(c, 3, 3).y); // select the box
	await page.keyboard.type("ExtremelyLongLabelXY"); // 20 chars
	// Live growth: still editing, but the box already widened to fit.
	await expect(page.locator(".editor")).toBeVisible();
	const [live] = (await shapes(page)) as BoxShape[];
	expect(live.w).toBe(26); // label 20 + borders 2 + padding 4
	await page.keyboard.press("Enter");
	expect(await ascii(page)).toBe(
		[
			"┌────────────────────────┐",
			"│  ExtremelyLongLabelXY  │",
			"└────────────────────────┘",
		].join("\n"),
	);
});

test("Shift+Enter makes a multi-line label", async ({ page }) => {
	await seedDoc(page, [
		{ type: "box", id: 1, x: 2, y: 2, w: 3, h: 3, text: "" },
	]);
	const c = await canvasRect(page);
	await page.mouse.click(cellPx(c, 3, 3).x, cellPx(c, 3, 3).y);
	await page.keyboard.type("ab");
	await page.keyboard.press("Shift+Enter");
	await page.keyboard.type("cd");
	await page.keyboard.press("Enter");
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.text).toBe("ab\ncd");
	expect(await ascii(page)).toBe(
		["┌──────┐", "│  ab  │", "│  cd  │", "└──────┘"].join("\n"),
	);
});

test("Escape cancels a label edit and reverts live growth", async ({
	page,
}) => {
	await seedDoc(page, [
		{ type: "box", id: 1, x: 2, y: 2, w: 9, h: 3, text: "Old" },
	]);
	const c = await canvasRect(page);
	await page.mouse.click(cellPx(c, 4, 3).x, cellPx(c, 4, 3).y);
	await page.keyboard.type("ReplacementThatGrows");
	await page.keyboard.press("Escape");
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.text).toBe("Old");
	expect(b.w).toBe(9);
	expect(await ascii(page)).toBe(
		["┌───────┐", "│  Old  │", "└───────┘"].join("\n"),
	);
});

test("arrow tool drag from box to box attaches both endpoints", async ({
	page,
}) => {
	await seedDoc(page, [
		{ type: "box", id: 1, x: 2, y: 2, w: 12, h: 5, text: "" },
		{ type: "box", id: 2, x: 30, y: 2, w: 12, h: 5, text: "" },
	]);
	const c = await canvasRect(page);
	await page.keyboard.press("a");
	await drag(page, cellPx(c, 13, 4), cellPx(c, 30, 4)); // right border → left border
	const arrow = (await shapes(page)).find(
		(s) => s.type === "arrow",
	) as ArrowShape;
	expect(arrow.box1).toBe(1);
	expect(arrow.box2).toBe(2);
	expect(await ascii(page)).toBe(
		[
			"┌──────────┐                ┌──────────┐",
			"│          │                │          │",
			"│          │───────────────▶│          │",
			"│          │                │          │",
			"└──────────┘                └──────────┘",
		].join("\n"),
	);
});

test("arrow tool drags a free arrow across empty canvas", async ({ page }) => {
	await seedDoc(page, []);
	const c = await canvasRect(page);
	await page.keyboard.press("a");
	await drag(page, cellPx(c, 2, 2), cellPx(c, 12, 2));
	const [arrow] = (await shapes(page)) as ArrowShape[];
	expect(arrow.type).toBe("arrow");
	expect(arrow.box1).toBeNull();
	expect(arrow.box2).toBeNull();
	expect(await ascii(page)).toBe("──────────▶");
});

test("text tool places free text; canvas right-click promotes it", async ({
	page,
}) => {
	await seedDoc(page, []);
	const c = await canvasRect(page);
	// Double-click places the text: a single click's mousedown default
	// action moves focus to the body, which blurs (and empty-commits) the
	// inline editor before any typing can reach it.
	await page.mouse.dblclick(cellPx(c, 5, 3).x, cellPx(c, 5, 3).y);
	await page.keyboard.type("note");
	await page.keyboard.press("Enter");
	expect(await ascii(page)).toBe("note");
	// Dblclick reopens the inline editor; another dblclick on the editor
	// overlay is a select-word gesture and must NOT promote (regression:
	// accidental double-clicks used to turn text into boxes). Right-click
	// on the overlay is inert too — promotion moved to the canvas.
	await page.mouse.dblclick(cellPx(c, 6, 3).x, cellPx(c, 6, 3).y);
	await page.mouse.dblclick(cellPx(c, 6, 3).x, cellPx(c, 6, 3).y);
	await page.mouse.click(cellPx(c, 6, 3).x, cellPx(c, 6, 3).y, {
		button: "right",
	});
	expect((await shapes(page))[0].type).toBe("text");
	await page.keyboard.press("Enter"); // commit the reopened editor
	// Right-click the placed text on the canvas: it becomes a box in place.
	await page.mouse.click(cellPx(c, 6, 3).x, cellPx(c, 6, 3).y, {
		button: "right",
	});
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.type).toBe("box");
	expect(b.text).toBe("note");
	expect(await ascii(page)).toBe(
		["┌────────┐", "│  note  │", "└────────┘"].join("\n"),
	);
});

test("Control+b in the text editor promotes it to a box", async ({ page }) => {
	await seedDoc(page, [{ type: "text", id: 1, x: 5, y: 3, text: "note" }]);
	const c = await canvasRect(page);
	await page.mouse.dblclick(cellPx(c, 6, 3).x, cellPx(c, 6, 3).y);
	await page.keyboard.press("Control+b");
	await page.keyboard.press("Enter");
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.type).toBe("box");
	expect(b.text).toBe("note");
});

test("group tool drag creates a frame and typing titles it with a tab", async ({
	page,
}) => {
	await seedDoc(page, []);
	const c = await canvasRect(page);
	await page.keyboard.press("g");
	await drag(page, cellPx(c, 2, 2), cellPx(c, 21, 8)); // 20x7 frame
	await page.keyboard.type("Team");
	await page.keyboard.press("Enter");
	const [g] = (await shapes(page)) as GroupShape[];
	expect(g.type).toBe("group");
	expect(g.text).toBe("Team");
	expect(g.h).toBeGreaterThanOrEqual(5); // tall enough for the title tab
	expect(await ascii(page)).toBe(
		[
			"╔══════╗",
			"║ Team ║",
			"╠══════╩═══════════╗",
			"║                  ║",
			"║                  ║",
			"║                  ║",
			"║                  ║",
			"║                  ║",
			"╚══════════════════╝",
		].join("\n"),
	);
});

test("double-click on an existing box edits its label", async ({ page }) => {
	await seedDoc(page, [
		{ type: "box", id: 1, x: 2, y: 2, w: 12, h: 5, text: "Old" },
	]);
	const c = await canvasRect(page);
	await page.mouse.dblclick(cellPx(c, 7, 4).x, cellPx(c, 7, 4).y);
	await page.keyboard.type("er"); // caret sits at the end of 'Old'
	await page.keyboard.press("Enter");
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.text).toBe("Older");
	expect(await ascii(page)).toBe(
		[
			"┌──────────┐",
			"│          │",
			"│  Older   │",
			"│          │",
			"└──────────┘",
		].join("\n"),
	);
});

test("typing labels a selected arrow with an embedded caption", async ({
	page,
}) => {
	await seedDoc(page, [
		{
			type: "arrow",
			id: 1,
			x1: 2,
			y1: 2,
			x2: 22,
			y2: 2,
			box1: null,
			box2: null,
		},
	]);
	const c = await canvasRect(page);
	await page.mouse.click(cellPx(c, 12, 2).x, cellPx(c, 12, 2).y); // select the arrow
	await page.keyboard.type("go");
	await page.keyboard.press("Enter");
	const [arrow] = (await shapes(page)) as ArrowShape[];
	expect(arrow.text).toBe("go");
	expect(await ascii(page)).toBe("──────── go ────────▶");
});

test("double-click on a lane header edits the lane title", async ({ page }) => {
	await seedDoc(page, [
		{
			type: "group",
			id: 1,
			x: 2,
			y: 2,
			w: 24,
			h: 8,
			text: "",
			lanes: ["", ""],
		},
	]);
	const c = await canvasRect(page);
	// The header band's claimed cells are the frame borders; dblclick the
	// left border at the header row to hit the group's first lane.
	await page.mouse.dblclick(cellPx(c, 2, 3).x, cellPx(c, 2, 3).y);
	await page.keyboard.type("Todo");
	await page.keyboard.press("Enter");
	const [g] = (await shapes(page)) as GroupShape[];
	expect(g.lanes).toEqual(["Todo", ""]);
	expect(await ascii(page)).toBe(
		[
			"╔═══════════╦══════════╗",
			"║ Todo      ║          ║",
			"╠═══════════╬══════════╣",
			"║           ║          ║",
			"║           ║          ║",
			"║           ║          ║",
			"║           ║          ║",
			"╚═══════════╩══════════╝",
		].join("\n"),
	);
});

test("create-box drag under 3x3 clamps to the minimum size", async ({
	page,
}) => {
	await seedDoc(page, []);
	const c = await canvasRect(page);
	await page.keyboard.press("b");
	await drag(page, cellPx(c, 5, 5), cellPx(c, 6, 6)); // sub-minimum drag
	const [b] = (await shapes(page)) as BoxShape[];
	expect(b.w).toBe(3);
	expect(b.h).toBe(3);
	expect(await ascii(page)).toBe(["┌─┐", "│ │", "└─┘"].join("\n"));
});
