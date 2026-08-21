import { describe, expect, it } from "vitest";
import { exportAscii } from "../src/export";
import type { ArrowShape, BoxShape, Shape, TextShape } from "../src/types";

const box = (
	id: number,
	x: number,
	y: number,
	w: number,
	h: number,
	text = "",
): BoxShape => ({ type: "box", id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape => ({
	type: "arrow",
	id,
	x1: 0,
	y1: 0,
	x2: 0,
	y2: 0,
	box1: null,
	box2: null,
	...over,
});

describe("exportAscii", () => {
	it("returns empty string for an empty canvas", () => {
		expect(exportAscii([])).toBe("");
	});

	it("renders a box with a centered label, trimmed to content bounds", () => {
		expect(exportAscii([box(1, 2, 1, 7, 3, "hi")])).toBe(
			["┌─────┐", "│ hi  │", "└─────┘"].join("\n"),
		);
	});

	it("routes an attached arrow between boxes with head adjacent to the border", () => {
		const a = box(1, 0, 0, 5, 3);
		const b = box(2, 12, 0, 5, 3);
		const shapes: Shape[] = [a, b, arrow(3, { box1: 1, box2: 2 })];
		expect(exportAscii(shapes)).toBe(
			["┌───┐       ┌───┐", "│   │──────▶│   │", "└───┘       └───┘"].join(
				"\n",
			),
		);
	});

	it("re-routes when the attached box moves", () => {
		const a = box(1, 0, 0, 5, 3);
		const b = box(2, 12, 0, 5, 3);
		const shapes: Shape[] = [a, b, arrow(3, { box1: 1, box2: 2 })];
		exportAscii(shapes); // resolve once at the original spot
		b.y = 10;
		const out = exportAscii(shapes);
		expect(out).toContain("▼"); // approach turned vertical
		expect(out.split("\n").length).toBeGreaterThan(3);
	});

	it("embeds an arrow label mid-line with one space of padding", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 0, x2: 10, y2: 0, text: "go" }),
		];
		expect(exportAscii(shapes)).toBe("─── go ───▶");
	});

	it("renders free-standing multi-line text", () => {
		const t: TextShape = { type: "text", id: 1, x: 3, y: 2, text: "ab\nc" };
		expect(exportAscii([t])).toBe("ab\nc");
	});
});
