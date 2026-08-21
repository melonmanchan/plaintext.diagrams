import { describe, expect, it } from "vitest";
import { exportAscii } from "../src/export";
import { parseAscii } from "../src/import";
import { insideGroup } from "../src/shapes";
import type { ArrowShape, BoxShape, GroupShape, Shape } from "../src/types";

const box = (
	id: number,
	x: number,
	y: number,
	w: number,
	h: number,
	text = "",
): BoxShape => ({ type: "box", id, x, y, w, h, text });

const group = (
	id: number,
	x: number,
	y: number,
	w: number,
	h: number,
	text = "",
): GroupShape => ({ type: "group", id, x, y, w, h, text });

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

describe("group frames", () => {
	it("renders a titled frame with a tab on top", () => {
		const shapes: Shape[] = [
			group(1, 0, 0, 30, 9, "Backend"),
			box(2, 3, 4, 9, 3, "API"),
			box(3, 17, 4, 9, 3, "DB"),
			arrow(4, { box1: 2, box2: 3 }),
		];
		expect(exportAscii(shapes)).toBe(
			[
				"╔═════════╗",
				"║ Backend ║",
				"╠═════════╩══════════════════╗",
				"║                            ║",
				"║  ┌───────┐     ┌───────┐   ║",
				"║  │  API  │────▶│  DB   │   ║",
				"║  └───────┘     └───────┘   ║",
				"║                            ║",
				"╚════════════════════════════╝",
			].join("\n"),
		);
	});

	it("renders an untitled group as a plain frame", () => {
		expect(exportAscii([group(1, 0, 0, 10, 3)])).toBe(
			["╔════════╗", "║        ║", "╚════════╝"].join("\n"),
		);
	});

	it("uses double-line unicode characters with tab junctions", () => {
		const out = exportAscii([group(1, 0, 0, 12, 5, "G")]);
		expect(out).toContain("╔═══╗");
		expect(out).toContain("║ G ║");
		expect(out).toContain("╠═══╩══════╗");
		expect(out).toContain("╚══════════╝");
	});

	it("round-trips through the parser with title and contents intact", () => {
		const shapes: Shape[] = [
			group(1, 0, 0, 30, 9, "Backend"),
			box(2, 3, 4, 9, 3, "API"),
			box(3, 17, 4, 9, 3, "DB"),
			arrow(4, { box1: 2, box2: 3 }),
		];
		const first = exportAscii(shapes);
		const reparsed = parseAscii(first);
		const g = reparsed.find((s): s is GroupShape => s.type === "group");
		expect(g).toBeDefined();
		expect(g?.text).toBe("Backend");
		expect([g?.x, g?.y, g?.w, g?.h]).toEqual([0, 0, 30, 9]);
		expect(reparsed.filter((s) => s.type === "box")).toHaveLength(2);
		expect(exportAscii(reparsed)).toBe(first);
	});

	it("unicode export parses back into a real group, not text", () => {
		const shapes: Shape[] = [
			group(1, 0, 0, 30, 9, "Backend"),
			box(2, 3, 4, 9, 3, "API"),
		];
		const uni = exportAscii(shapes);
		const reparsed = parseAscii(uni);
		const g = reparsed.find((s): s is GroupShape => s.type === "group");
		expect(g).toBeDefined();
		expect(g?.text).toBe("Backend");
		expect(reparsed.filter((s) => s.type === "text")).toHaveLength(0);
		expect(exportAscii(reparsed)).toBe(uni);
	});

	it("recovers labels overlaid on vertical arrows", () => {
		const shapes: Shape[] = [
			box(1, 0, 0, 12, 3, "Top"),
			box(2, 0, 12, 12, 3, "Bottom"),
			arrow(3, { box1: 1, box2: 2, text: "click events" }),
		];
		const out = exportAscii(shapes);
		const reparsed = parseAscii(out);
		const a = reparsed.find((s): s is ArrowShape => s.type === "arrow");
		expect(a).toBeDefined();
		expect(a?.text).toBe("click events");
		expect(reparsed.filter((s) => s.type === "text")).toHaveLength(0);
	});

	it("parses a group whose border is crossed by arrows", () => {
		const shapes: Shape[] = [
			box(1, 0, 4, 10, 3, "Out"),
			group(2, 20, 0, 30, 12, "Zone"),
			box(3, 26, 5, 10, 3, "In"),
			arrow(4, { box1: 1, box2: 3 }), // crosses the group's left border
		];
		const out = exportAscii(shapes);
		const reparsed = parseAscii(out);
		const g = reparsed.find((s): s is GroupShape => s.type === "group");
		expect(g).toBeDefined();
		expect(g?.text).toBe("Zone");
		const a = reparsed.find((s): s is ArrowShape => s.type === "arrow");
		expect(a).toBeDefined();
		expect(a?.box1).not.toBeNull();
		expect(a?.box2).not.toBeNull();
		expect(exportAscii(reparsed)).toBe(out);
	});

	it("insideGroup covers boxes, texts, and free arrows", () => {
		const g = group(1, 0, 0, 30, 10);
		expect(insideGroup(box(2, 5, 3, 6, 3), g)).toBe(true);
		expect(insideGroup(box(3, 25, 3, 10, 3), g)).toBe(false); // sticks out
		expect(
			insideGroup({ type: "text", id: 4, x: 2, y: 2, text: "hi" }, g),
		).toBe(true);
		expect(insideGroup(arrow(5, { x1: 2, y1: 2, x2: 10, y2: 5 }), g)).toBe(
			true,
		);
		expect(insideGroup(arrow(6, { x1: 2, y1: 2, x2: 40, y2: 5 }), g)).toBe(
			false,
		);
	});
});
