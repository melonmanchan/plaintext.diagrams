import { describe, expect, it } from "vitest";
import { parseShapesJson, serializeShapes } from "../src/interop";
import type { ArrowShape, BoxShape } from "../src/types";

describe("shapes JSON interop", () => {
	it("returns null for non-JSON so callers fall through to the text parser", () => {
		expect(parseShapesJson("┌───┐\n│ A │\n└───┘")).toBeNull();
		expect(parseShapesJson("hello world")).toBeNull();
	});

	it("accepts a bare array and an object envelope identically", () => {
		const body = '{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3,"text":"A"}';
		const a = parseShapesJson(`[${body}]`);
		const b = parseShapesJson(`{"shapes":[${body}]}`);
		expect(a?.errors).toEqual([]);
		expect(b?.shapes).toEqual(a?.shapes);
	});

	it("reports invalid JSON loudly instead of returning null", () => {
		const r = parseShapesJson('[{"type":"box",]');
		expect(r).not.toBeNull();
		expect(r?.errors[0]).toContain("invalid JSON");
	});

	it("rejects dangling arrow references all-or-nothing", () => {
		const r = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":99}]',
		);
		expect(r?.errors[0]).toContain("box id 99");
		expect(r?.shapes).toEqual([]);
	});

	it("auto-assigns missing ids without colliding with explicit ones", () => {
		const r = parseShapesJson(
			'[{"type":"box","x":0,"y":0,"w":8,"h":3},{"type":"box","id":1,"x":20,"y":0,"w":8,"h":3}]',
		);
		const ids = r?.shapes.map((s) => s.id);
		expect(new Set(ids).size).toBe(2);
	});

	it("auto-fits undersized boxes to their labels", () => {
		const r = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":3,"h":3,"text":"a very long label"}]',
		);
		const b = r?.shapes[0] as BoxShape;
		expect(b.w).toBeGreaterThanOrEqual("a very long label".length + 4);
	});

	it("rejects duplicate explicit ids", () => {
		const r = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"box","id":1,"x":20,"y":0,"w":8,"h":3}]',
		);
		expect(r?.errors[0]).toContain("duplicate shape id 1");
		expect(r?.shapes).toEqual([]);
	});

	it("rejects non-string text on any shape instead of crashing later", () => {
		for (const bad of [
			'[{"type":"box","x":0,"y":0,"w":8,"h":3,"text":123}]',
			'[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"box","id":2,"x":20,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":2,"text":7}]',
			'[{"type":"group","x":0,"y":0,"w":30,"h":10,"text":5,"lanes":["a","b"]}]',
		]) {
			const r = parseShapesJson(bad);
			expect(r?.errors[0]).toContain('"text" must be a string');
			expect(r?.shapes).toEqual([]);
		}
	});

	it("rejects non-numeric coordinates and dimensions", () => {
		expect(
			parseShapesJson('[{"type":"box","x":"abc","y":0,"w":8,"h":3,"text":"A"}]')
				?.errors[0],
		).toContain('"x" and "y" must be numbers');
		expect(
			parseShapesJson('[{"type":"box","x":0,"y":0,"w":"8","h":3,"text":"A"}]')
				?.errors[0],
		).toContain('"w" and "h" must be numbers');
		expect(
			parseShapesJson('[{"type":"arrow","x1":"a","y1":0,"x2":5,"y2":5}]')
				?.errors[0],
		).toContain("x1,y1,x2,y2 must be numbers");
	});

	it("rejects lanes that are not an array of strings", () => {
		const r = parseShapesJson(
			'[{"type":"group","x":0,"y":0,"w":30,"h":10,"lanes":[1,2]}]',
		);
		expect(r?.errors[0]).toContain('"lanes" must be an array of strings');
	});

	it("clamps oversized geometry to the world instead of freezing render", () => {
		const r = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":100000,"h":100000,"text":"A"},' +
				'{"type":"arrow","id":2,"x1":-5,"y1":0,"x2":1e9,"y2":1e9}]',
		);
		expect(r?.errors).toEqual([]);
		const b = r?.shapes[0] as BoxShape;
		const a = r?.shapes[1] as ArrowShape;
		expect(b.w).toBeLessThanOrEqual(1000);
		expect(b.h).toBeLessThanOrEqual(500);
		expect(a.x1).toBe(0);
		expect(a.x2).toBe(999);
		expect(a.y2).toBe(499);
	});

	it("serialization round-trips through the parser", () => {
		const parsed = parseShapesJson(
			'[{"type":"box","id":1,"x":0,"y":0,"w":10,"h":3,"text":"A","style":"round"},' +
				'{"type":"group","id":2,"x":20,"y":0,"w":30,"h":10,"text":"G","lanes":["L","R"]},' +
				'{"type":"arrow","id":3,"x1":0,"y1":0,"x2":0,"y2":0,"box1":1,"box2":null,"text":"go","style":"dashed"}]',
		);
		if (!parsed) throw new Error("expected shapes JSON");
		const src = parsed.shapes;
		const re = parseShapesJson(serializeShapes(src));
		expect(re?.errors).toEqual([]);
		expect(re?.shapes).toEqual(src);
		const a = re?.shapes.find((s): s is ArrowShape => s.type === "arrow");
		expect(a?.style).toBe("dashed");
	});
});
