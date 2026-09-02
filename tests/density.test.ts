import { describe, expect, it } from "vitest";
import { MAX_COLS } from "../src/constants";
import { lintShapes } from "../src/lint";
import { pathMidpoint, rasterize, routeAll } from "../src/raster";
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

const text = (id: number, x: number, y: number, t: string): TextShape => ({
	type: "text",
	id,
	x,
	y,
	text: t,
});

function must<T>(v: T | undefined | null): T {
	if (v == null) throw new Error("expected a value");
	return v;
}

describe("label placement under density", () => {
	it("keeps the exact path midpoint when it is clean", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 8, 3, "A"),
			box(2, 30, 0, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2, text: "hi" }),
		];
		const r = must(routeAll(shapes).get(3));
		expect(r.squeezed).toBe(false);
		expect(r.label).toEqual(pathMidpoint(r.pts));
	});

	it("slides a label off foreign content instead of stamping over it", () => {
		const shapes: Shape[] = [
			box(1, 0, 4, 8, 3, "A"),
			box(2, 52, 4, 8, 3, "B"),
			text(4, 26, 5, "XXXX"),
			arrow(3, { box1: 1, box2: 2, text: "hi" }),
		];
		const r = must(routeAll(shapes).get(3));
		expect(r.squeezed).toBe(false);
		const mid = must(r.label);
		// label cells (text + one padding space each side) clear of the text
		expect(mid.x + 1 < 26 || mid.x - 2 > 29).toBe(true);
		// the bystander text survives the raster untouched
		const g = rasterize(shapes, 80, 12);
		const row = Array.from({ length: 4 }, (_, k) => g.ch[5 * 80 + 26 + k]);
		expect(row.join("")).toBe("XXXX");
	});

	it("falls back to the midpoint and flags a squeezed label", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 8, 3, "A"),
			box(2, 12, 0, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2, text: "verylonglabel" }),
		];
		const r = must(routeAll(shapes).get(3));
		expect(r.squeezed).toBe(true);
		expect(r.label).toEqual(pathMidpoint(r.pts));
	});
});

describe("arrow-arrow rail avoidance", () => {
	it("routes an attached arrow off an occupied corridor", () => {
		const shapes: Shape[] = [
			arrow(10, { x1: 12, y1: 5, x2: 48, y2: 5 }),
			box(1, 0, 4, 8, 3, "A"),
			box(2, 52, 4, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2 }),
		];
		const r = must(routeAll(shapes).get(3));
		expect(r.rails).toBe(0);
		// the straight row-5 route was abandoned for a detour
		expect(r.pts.some((p) => p.y !== 5)).toBe(true);
	});

	it("keeps the straight route when the corridor is free", () => {
		const shapes: Shape[] = [
			box(1, 0, 4, 8, 3, "A"),
			box(2, 52, 4, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2 }),
		];
		const r = must(routeAll(shapes).get(3));
		expect(r.pts).toEqual([
			{ x: 8, y: 5 },
			{ x: 51, y: 5 },
		]);
	});
});

describe("lintShapes", () => {
	it("reports overlapping boxes", () => {
		const issues = lintShapes([
			box(1, 0, 0, 10, 4, "A"),
			box(2, 5, 2, 10, 4, "B"),
		]);
		expect(issues.some((i) => i.code === "box-overlap")).toBe(true);
	});

	it("reports a box hugging a group frame it is outside of", () => {
		const shapes: Shape[] = [
			{ type: "group", id: 1, x: 0, y: 0, w: 20, h: 7, text: "G" },
			box(2, 21, 1, 6, 3, "B"),
		];
		const issues = lintShapes(shapes);
		expect(issues.some((i) => i.code === "group-hug")).toBe(true);
	});

	it("reports a box crossing a group frame", () => {
		const shapes: Shape[] = [
			{ type: "group", id: 1, x: 0, y: 0, w: 20, h: 7, text: "G" },
			box(2, 18, 1, 6, 3, "B"),
		];
		const issues = lintShapes(shapes);
		expect(issues.some((i) => i.code === "group-crossing")).toBe(true);
	});

	it("reports a free arrow overdrawing a box", () => {
		const shapes: Shape[] = [
			box(1, 10, 4, 8, 3, "A"),
			arrow(2, { x1: 0, y1: 5, x2: 30, y2: 5 }),
		];
		const issues = lintShapes(shapes);
		expect(issues.some((i) => i.code === "arrow-overdraw")).toBe(true);
	});

	it("reports two free arrows sharing a rail", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 5, x2: 20, y2: 5 }),
			arrow(2, { x1: 0, y1: 5, x2: 20, y2: 5 }),
		];
		const issues = lintShapes(shapes);
		expect(issues.some((i) => i.code === "arrow-rail")).toBe(true);
	});

	it("reports a squeezed label with the run it needs", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 8, 3, "A"),
			box(2, 12, 0, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2, text: "verylonglabel" }),
		];
		const issues = lintShapes(shapes);
		const hit = must(issues.find((i) => i.code === "label-squeezed"));
		expect(hit.msg).toContain("≥17");
	});

	it("is silent on a clean diagram", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 12, 3, "Client"),
			box(2, 32, 0, 11, 3, "API"),
			arrow(3, { box1: 1, box2: 2, text: "HTTP" }),
		];
		expect(lintShapes(shapes)).toEqual([]);
	});
});

describe("review fixes", () => {
	it("lintShapes does not mutate the caller's arrows", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 8, 3, "A"),
			box(2, 30, 0, 8, 3, "B"),
			arrow(3, { box1: 1, box2: 2 }),
		];
		lintShapes(shapes);
		const ar = must(shapes.find((s) => s.id === 3));
		expect(ar.type === "arrow" && ar.x1).toBe(0);
		expect(ar.type === "arrow" && ar.y1).toBe(0);
	});

	it("fallback label padding never erases an earlier foreign line", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 4, x2: 20, y2: 4 }),
			arrow(2, { x1: 6, y1: 3, x2: 14, y2: 3, text: "ab\ncd" }),
		];
		const r = must(routeAll(shapes).get(2));
		expect(r.squeezed).toBe(true); // second label row has no clean spot
		const g = rasterize(shapes, 30, 10);
		// label text legitimately overprints the foreign line …
		expect(g.ch[4 * 30 + 9]).toBe("c");
		expect(g.ch[4 * 30 + 10]).toBe("d");
		// … but its padding spaces must not sever it
		expect(g.ch[4 * 30 + 8]).toBe("-");
		expect(g.ch[4 * 30 + 11]).toBe("-");
	});

	it("a single mutually-shared bend cell counts as one rail", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 5, x2: 5, y2: 0 }),
			arrow(2, { x1: 10, y1: 5, x2: 5, y2: 10 }),
		];
		const r = must(routeAll(shapes).get(2));
		expect(r.rails).toBe(1);
		expect(lintShapes(shapes).some((i) => i.code === "arrow-rail")).toBe(false);
	});

	it("labels clipped by the world cap report squeezed, not clean", () => {
		const shapes: Shape[] = [
			arrow(1, {
				x1: MAX_COLS - 3,
				y1: 2,
				x2: MAX_COLS - 1,
				y2: 2,
				text: "verywide!",
			}),
		];
		const r = must(routeAll(shapes).get(1));
		expect(r.squeezed).toBe(true);
	});
});
