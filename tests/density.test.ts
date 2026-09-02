import { describe, expect, it } from "vitest";
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
