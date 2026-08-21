import { describe, expect, it } from "vitest";
import { COLS } from "../src/constants";
import { rasterize } from "../src/raster";
import type { ArrowShape, BoxShape, Shape } from "../src/types";

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

describe("rasterize", () => {
	it("creates + junctions where independent lines cross", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 3, x2: 8, y2: 3 }),
			arrow(2, { x1: 4, y1: 0, x2: 4, y2: 6 }),
		];
		const r = rasterize(shapes);
		expect(r.ch[3 * COLS + 4]).toBe("+");
		expect(r.ch[3 * COLS + 8]).toBe(">");
		expect(r.ch[6 * COLS + 4]).toBe("v");
	});

	it("later box wins overlapping cells; text stays above fills", () => {
		const behind: BoxShape = {
			type: "box",
			id: 1,
			x: 0,
			y: 0,
			w: 10,
			h: 5,
			text: "XXXXXXXX",
		};
		const front: BoxShape = {
			type: "box",
			id: 2,
			x: 2,
			y: 1,
			w: 6,
			h: 4,
			text: "",
		};
		const r = rasterize([behind, front]);
		// front's top border draws over behind's interior (label row is y=2)
		expect(r.ch[1 * COLS + 4]).toBe("-");
		expect(r.id[1 * COLS + 4]).toBe(2);
		// later box's fill claims overlapping empty interior
		expect(r.ch[3 * COLS + 4]).toBe(" ");
		expect(r.id[3 * COLS + 4]).toBe(2);
		// text has top priority: behind's label shows through front's fill and border
		expect(r.ch[2 * COLS + 4]).toBe("X");
		expect(r.ch[2 * COLS + 2]).toBe("X");
	});

	it("keeps text above arrow lines", () => {
		const shapes: Shape[] = [
			arrow(1, { x1: 0, y1: 0, x2: 8, y2: 0 }),
			{ type: "text", id: 2, x: 2, y: 0, text: "hi" },
		];
		const r = rasterize(shapes);
		expect(r.ch[2]).toBe("h");
		expect(r.ch[3]).toBe("i");
		expect(r.ch[1]).toBe("-");
	});
});
