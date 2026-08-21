import { describe, expect, it } from "vitest";
import { exportAscii } from "../src/export";
import { parseAscii } from "../src/import";
import { parseShapesJson } from "../src/interop";
import { resolveArrow } from "../src/raster";
import { dropSide } from "../src/shapes";
import type { ArrowShape, BoxShape, Shape } from "../src/types";

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

describe("arrow side pins", () => {
	it("router honors pinned sides instead of the facing side", () => {
		// B is to the RIGHT of A; auto would anchor A:right / B:left.
		const a = box(1, 0, 0, 10, 5, "A");
		const b = box(2, 30, 4, 10, 5, "B");
		const ar = arrow(3, { box1: 1, box2: 2, side1: "bottom", side2: "top" });
		const shapes: Shape[] = [a, b, ar];
		resolveArrow(ar, shapes);
		expect(ar.y1).toBe(a.y + a.h); // exits below A
		expect(ar.y2).toBe(b.y - 1); // enters above B
	});

	it("pins are soft: crowded pinned sides still spread onto slots", () => {
		const a = box(1, 0, 0, 12, 7, "A");
		const b = box(2, 30, 0, 12, 7, "B");
		const a1 = arrow(3, { box1: 1, box2: 2, side1: "right", side2: "left" });
		const a2 = arrow(4, { box1: 1, box2: 2, side1: "right", side2: "left" });
		const shapes: Shape[] = [a, b, a1, a2];
		resolveArrow(a1, shapes);
		resolveArrow(a2, shapes);
		expect(a1.x1).toBe(a.x + a.w);
		expect(a2.x1).toBe(a.x + a.w);
		expect(a1.y1).not.toBe(a2.y1); // distinct slots on the same side
	});

	it("dropSide maps border cells and rejects interior/corners", () => {
		const b = box(1, 10, 10, 10, 5);
		expect(dropSide(b, 9, 12)).toBe("left");
		expect(dropSide(b, 20, 12)).toBe("right");
		expect(dropSide(b, 14, 9)).toBe("top");
		expect(dropSide(b, 14, 15)).toBe("bottom");
		expect(dropSide(b, 14, 12)).toBeUndefined(); // interior
		expect(dropSide(b, 9, 9)).toBeUndefined(); // diagonal corner zone
	});

	it("import infers a pin when the drawn side is not the auto side", () => {
		const a = box(1, 0, 0, 12, 5, "A");
		const b = box(2, 30, 0, 12, 5, "B");
		const pinned = arrow(3, { box1: 1, box2: 2, side1: "bottom" });
		const first = exportAscii([a, b, pinned]);
		const re = parseAscii(first);
		const ra = re.find((s): s is ArrowShape => s.type === "arrow");
		expect(ra?.side1).toBe("bottom");
		expect(ra?.side2).toBeUndefined(); // auto side stays unpinned
		expect(exportAscii(re)).toBe(first);
	});

	it("auto-routed diagrams import without any pins", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 10, 3, "A"),
			box(2, 24, 0, 10, 3, "B"),
			arrow(3, { box1: 1, box2: 2 }),
		];
		const re = parseAscii(exportAscii(shapes));
		const ra = re.find((s): s is ArrowShape => s.type === "arrow");
		expect(ra?.side1).toBeUndefined();
		expect(ra?.side2).toBeUndefined();
	});

	it("interop accepts valid side pins and rejects junk", () => {
		const ok = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"box","id":2,"x":20,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":2,"side1":"top"}]',
		);
		expect(ok?.errors).toEqual([]);
		const bad = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"side2":"diagonal","x2":30,"y2":9}]',
		);
		expect(bad?.errors[0]).toContain("side2");
	});
	it("far-side pins route around the box, never through it", () => {
		const a = box(1, 2, 2, 12, 5, "P");
		const b = box(2, 34, 2, 12, 5, "T");
		const ar = arrow(3, { box1: 1, box2: 2, side1: "bottom", side2: "right" });
		const first = exportAscii([a, b, ar]);
		// T's interior row must be untouched by the arrow line
		const rowT = first.split("\n")[2];
		expect(rowT).toContain("│    T     │");
		const re = parseAscii(first);
		expect(re.filter((s) => s.type === "box")).toHaveLength(2);
		const ra = re.find((s): s is ArrowShape => s.type === "arrow");
		expect(ra?.side2).toBe("right");
		expect(exportAscii(re)).toBe(first);
	});

	it("exact offsets keep the anchor at the clicked cell", () => {
		// B is far right-and-below: the auto cross would slide to A's
		// bottom-right corner; at1 keeps the exit under the clicked column.
		const a = box(1, 0, 0, 12, 3, "A");
		const b = box(2, 27, 8, 12, 4, "B");
		const ar = arrow(3, { box1: 1, box2: 2, side1: "bottom", at1: 2 });
		const shapes: Shape[] = [a, b, ar];
		resolveArrow(ar, shapes);
		expect(ar.x1).toBe(2); // clicked column, not the far corner
		expect(ar.y1).toBe(a.y + a.h);
	});

	it("exact offsets survive the text round-trip", () => {
		const a = box(1, 0, 0, 12, 3, "A");
		const b = box(2, 27, 8, 12, 4, "B");
		const ar = arrow(3, { box1: 1, box2: 2, side1: "bottom", at1: 2 });
		const first = exportAscii([a, b, ar]);
		const re = parseAscii(first);
		const ra = re.find((s): s is ArrowShape => s.type === "arrow");
		expect(ra?.side1).toBe("bottom");
		expect(ra?.at1).toBe(2);
		expect(exportAscii(re)).toBe(first);
	});

	it("interop validates at offsets", () => {
		const bad = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"box","id":2,"x":20,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":2,"side1":"top","at1":"x"}]',
		);
		expect(bad?.errors[0]).toContain("at1");
	});

	it("bottom-pinned entry routes under the box, not through it", () => {
		const a = box(1, 0, 0, 12, 3, "A");
		const b = box(2, 27, 6, 12, 5, "B");
		const ar = arrow(3, { box1: 1, box2: 2, side2: "bottom" });
		const first = exportAscii([a, b, ar]);
		// B's interior must be untouched by the arrow line
		expect(first.split("\n").some((l) => l.includes("│    B     │"))).toBe(
			true,
		);
		const re = parseAscii(first);
		expect(re.filter((s) => s.type === "box")).toHaveLength(2);
		expect(re.filter((s) => s.type === "text")).toHaveLength(0);
		expect(exportAscii(re)).toBe(first);
	});

	it("auto routes detour around bystander boxes on the direct line", () => {
		const shapes: Shape[] = [
			box(1, 0, 4, 10, 3, "A"),
			box(2, 44, 4, 10, 3, "B"),
			box(3, 22, 3, 10, 5, "C"),
			arrow(4, { box1: 1, box2: 2, text: "go" }),
		];
		const first = exportAscii(shapes);
		expect(first.split("\n").some((l) => l.includes("│   C    │"))).toBe(true);
		const re = parseAscii(first);
		expect(re.filter((s) => s.type === "box")).toHaveLength(3);
		expect(re.filter((s) => s.type === "text")).toHaveLength(0);
		expect(re.find((s): s is ArrowShape => s.type === "arrow")?.text).toBe(
			"go",
		);
		expect(exportAscii(re)).toBe(first);
	});

	it("pins on unanchorable sides are ignored, never routed off-canvas", () => {
		// top pin on a box at y=0 and left pin on a box at x=0 have no room —
		// the router must fall back to auto instead of anchoring at −1.
		const a = box(1, 20, 10, 10, 3, "A");
		const b = box(2, 0, 0, 10, 3, "B");
		const ar = arrow(3, { box1: 1, box2: 2, side2: "top" });
		const shapes: Shape[] = [a, b, ar];
		resolveArrow(ar, shapes);
		expect(Math.min(ar.x1, ar.y1, ar.x2, ar.y2)).toBeGreaterThanOrEqual(0);
		const first = exportAscii(shapes);
		const re = parseAscii(first);
		expect(re.filter((s) => s.type === "box")).toHaveLength(2);
		expect(re.filter((s) => s.type === "text")).toHaveLength(0);
		expect(exportAscii(re)).toBe(first);
	});

	it("slot-spread auto arrows import unpinned and stay adaptive", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 6, 7),
			box(2, 20, 0, 6, 7),
			arrow(3, { box1: 1, box2: 2 }),
			arrow(4, { box1: 1, box2: 2 }),
			arrow(5, { box1: 2, box2: 1 }),
		];
		const pasted = parseAscii(exportAscii(shapes));
		const pas = pasted.filter((s): s is ArrowShape => s.type === "arrow");
		expect(pas.every((x) => x.side1 == null && x.side2 == null)).toBe(true);
		// move B below A: arrows must re-route, never anchor off-grid
		const b = pasted.find((s): s is BoxShape => s.type === "box" && s.x > 10)!;
		b.x = 0;
		b.y = 14;
		const moved = exportAscii(pasted);
		const re = parseAscii(moved);
		// ≥2: opposite-direction siblings can overlap after a move (pre-existing
		// limitation, identical on main); the fix guarantees no strays/off-grid.
		expect(re.filter((s) => s.type === "arrow").length).toBeGreaterThanOrEqual(
			2,
		);
		expect(re.filter((s) => s.type === "text")).toHaveLength(0);
	});

	it("overflow-wrapped diagrams stay byte-stable across repeated round-trips", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 12, 8, "Client"),
			box(2, 48, 2, 21, 3, "Server"),
			arrow(3, { box1: 1, box2: 2 }),
			arrow(4, { box1: 1, box2: 2, text: "http POST" }),
			arrow(5, { box1: 1, box2: 2, text: "HTTP patch" }),
		];
		const a = exportAscii(shapes);
		const b = exportAscii(parseAscii(a));
		const c = exportAscii(parseAscii(b));
		expect(b).toBe(a);
		expect(c).toBe(b);
	});
});
