import { CH, CW, MAX_COLS, MAX_ROWS } from "./constants";
import type {
	BoxShape,
	Corner,
	GroupShape,
	Guide,
	LaneSlot,
	Shape,
	Side,
} from "./types";
import { clamp } from "./util";

/* ============================================================
 * Shape geometry: hit zones, attachment, movement, sizing.
 * Pure over a shapes array — no app state.
 * ============================================================ */

export function boxAt(
	shapes: Shape[],
	cx: number,
	cy: number,
): BoxShape | null {
	for (let i = shapes.length - 1; i >= 0; i--) {
		const s = shapes[i];
		if (
			s.type === "box" &&
			cx >= s.x &&
			cx < s.x + s.w &&
			cy >= s.y &&
			cy < s.y + s.h
		)
			return s;
	}
	return null;
}

/** Attachment target: exact hit wins, else any box within 1 cell. */
export function boxAttachAt(
	shapes: Shape[],
	cx: number,
	cy: number,
): BoxShape | null {
	const exact = boxAt(shapes, cx, cy);
	if (exact) return exact;
	for (let i = shapes.length - 1; i >= 0; i--) {
		const s = shapes[i];
		if (
			s.type === "box" &&
			cx >= s.x - 1 &&
			cx < s.x + s.w + 1 &&
			cy >= s.y - 1 &&
			cy < s.y + s.h + 1
		)
			return s;
	}
	return null;
}

/** Perimeter cell of a box — the arrow-start zone when the box is selected. */
export function onBoxBorder(s: BoxShape, cx: number, cy: number): boolean {
	if (cx < s.x || cx >= s.x + s.w || cy < s.y || cy >= s.y + s.h) return false;
	return (
		cx === s.x || cx === s.x + s.w - 1 || cy === s.y || cy === s.y + s.h - 1
	);
}

/** Resize-handle positions in px, at the frame's outer corners. */
export function boxHandles(
	s: BoxShape | GroupShape,
): { c: Corner; px: number; py: number }[] {
	return [
		{ c: "nw", px: s.x * CW, py: s.y * CH },
		{ c: "ne", px: (s.x + s.w) * CW, py: s.y * CH },
		{ c: "sw", px: s.x * CW, py: (s.y + s.h) * CH },
		{ c: "se", px: (s.x + s.w) * CW, py: (s.y + s.h) * CH },
	];
}

/**
 * Reposition `s` at `o`'s coordinates shifted by (dx, dy).
 * Arrow endpoints that are free in `o` follow the drag and connect
 * to any box they land on; attached endpoints stay attached.
 */
export function placeFrom(
	s: Shape,
	o: Shape,
	dx: number,
	dy: number,
	shapes: Shape[],
): void {
	if (
		(s.type === "box" && o.type === "box") ||
		(s.type === "group" && o.type === "group")
	) {
		s.x = clamp(o.x + dx, 0, MAX_COLS - s.w);
		s.y = clamp(o.y + dy, 0, MAX_ROWS - s.h);
	} else if (s.type === "text" && o.type === "text") {
		s.x = clamp(o.x + dx, 0, MAX_COLS - 1);
		s.y = clamp(o.y + dy, 0, MAX_ROWS - 1);
	} else if (s.type === "arrow" && o.type === "arrow") {
		if (!o.box1) {
			s.x1 = clamp(o.x1 + dx, 0, MAX_COLS - 1);
			s.y1 = clamp(o.y1 + dy, 0, MAX_ROWS - 1);
			const b = boxAttachAt(shapes, s.x1, s.y1);
			s.box1 = b && b.id !== s.box2 ? b.id : null;
		}
		if (!o.box2) {
			s.x2 = clamp(o.x2 + dx, 0, MAX_COLS - 1);
			s.y2 = clamp(o.y2 + dy, 0, MAX_ROWS - 1);
			const b = boxAttachAt(shapes, s.x2, s.y2);
			s.box2 = b && b.id !== s.box1 ? b.id : null;
		}
	}
}

/** Smallest box that shows its whole label (never below 3×3). */
export function boxMinSize(s: { text: string }): [number, number] {
	if (!s.text) return [3, 3];
	// Borders (2) plus breathing room between label and border.
	const padX = 2;
	const lines = s.text.split("\n");
	return [
		Math.max(3, Math.max(...lines.map((l) => l.length)) + 2 + padX * 2),
		Math.max(3, lines.length + 2),
	];
}

export function fitBoxToLabel(s: BoxShape | GroupShape): void {
	const [minW, minH] = boxMinSize(s);
	if (s.w < minW) s.w = Math.min(minW, MAX_COLS - s.x);
	if (s.h < minH) s.h = Math.min(minH, MAX_ROWS - s.y);
}

/** Minimum group size: titled frames need the 2-row tab; lanes need a header band. */
export function groupMinSize(s: GroupShape): [number, number] {
	const tab = s.text ? 2 : 0;
	const n = s.lanes?.length ?? 0;
	if (n >= 2) return [Math.max(4, n * 6), tab + 5];
	if (!s.text) return [4, 3];
	return [Math.max(4, s.text.split("\n")[0].length + 4), 5];
}

/** Row of the group's main frame top border (below the tab when titled). */
export function groupTopRow(g: GroupShape): number {
	return g.text && g.h >= 5 ? g.y + 2 : g.y;
}

/** X positions of the separators between vertical lanes. */
export function laneBounds(g: GroupShape): number[] {
	const n = g.lanes?.length ?? 0;
	if (n < 2) return [];
	return Array.from(
		{ length: n - 1 },
		(_, i) => g.x + Math.round(((i + 1) * (g.w - 1)) / n),
	);
}

/**
 * Which border side of `b` the cell (cx, cy) belongs to — for pinning an
 * arrow endpoint from a drag/drop position. Interior cells and diagonal
 * corner zones return undefined (= auto).
 */
export function dropSide(
	b: BoxShape,
	cx: number,
	cy: number,
): Side | undefined {
	const sx = cx <= b.x ? "left" : cx >= b.x + b.w - 1 ? "right" : null;
	const sy = cy <= b.y ? "top" : cy >= b.y + b.h - 1 ? "bottom" : null;
	if (sx && !sy) return sx;
	if (sy && !sx) return sy;
	return undefined;
}

/** Lane interiors as [start, end] column pairs; a laneless group is one lane. */
function laneEdges(g: GroupShape): number[] {
	return [g.x, ...laneBounds(g), g.x + g.w - 1];
}

/** First interior content row (below the lane header band when present). */
function contentTopOf(g: GroupShape): number {
	return groupTopRow(g) + ((g.lanes?.length ?? 0) >= 2 ? 3 : 1);
}

/** Capture which lane slot each contained shape occupies (slot-keeping resize). */
export function captureGroupSlots(g: GroupShape, shapes: Shape[]): LaneSlot[] {
	const edges = laneEdges(g);
	const contentTop = contentTopOf(g);
	const out: LaneSlot[] = [];
	for (const s of shapes) {
		if (s.id === g.id || s.type === "arrow" || !insideGroup(s, g)) continue;
		const cx = s.type === "text" ? s.x : s.x + (s.w >> 1);
		let lane = 0;
		while (lane < edges.length - 2 && cx > edges[lane + 1]) lane++;
		out.push({
			id: s.id,
			lane,
			offX: s.x - (edges[lane] + 1),
			offY: s.y - contentTop,
		});
	}
	return out;
}

/** Re-place captured shapes inside their lane slots after the group resized. */
export function applyGroupSlots(
	g: GroupShape,
	shapes: Shape[],
	slots: LaneSlot[],
): void {
	const edges = laneEdges(g);
	const contentTop = contentTopOf(g);
	const bottom = g.y + g.h - 1;
	for (const slot of slots) {
		const s = shapes.find((sh) => sh.id === slot.id);
		if (!s || s.type === "arrow") continue;
		const lane = Math.min(slot.lane, edges.length - 2);
		const laneStart = edges[lane] + 1;
		const laneEnd = edges[lane + 1] - 1;
		const sw =
			s.type === "text"
				? Math.max(...(s.text || " ").split("\n").map((l) => l.length))
				: s.w;
		const sh2 = s.type === "text" ? (s.text || " ").split("\n").length : s.h;
		s.x = clamp(
			laneStart + slot.offX,
			laneStart,
			Math.max(laneStart, laneEnd - sw + 1),
		);
		s.y = clamp(
			contentTop + slot.offY,
			contentTop,
			Math.max(contentTop, bottom - sh2),
		);
	}
}

/**
 * Snap a dragged box/group to edge/center alignment with other
 * boxes and groups (within 1 cell). Mutates `s`; returns guides.
 */
export function snapBox(s: BoxShape | GroupShape, shapes: Shape[]): Guide[] {
	let bestX: { diff: number; x: number; guide: Guide } | null = null;
	let bestY: { diff: number; y: number; guide: Guide } | null = null;
	for (const o of shapes) {
		if ((o.type !== "box" && o.type !== "group") || o.id === s.id) continue;
		const candX: [number, number][] = [
			[o.x, o.x * CW], // left edges
			[o.x + o.w - s.w, (o.x + o.w) * CW], // right edges
			[Math.round(o.x + (o.w - s.w) / 2), (o.x + o.w / 2) * CW], // centers
		];
		for (const [tx, px] of candX) {
			const diff = Math.abs(tx - s.x);
			if (diff <= 1 && (!bestX || diff < bestX.diff))
				bestX = { diff, x: tx, guide: { axis: "v", px } };
		}
		const candY: [number, number][] = [
			[o.y, o.y * CH],
			[o.y + o.h - s.h, (o.y + o.h) * CH],
			[Math.round(o.y + (o.h - s.h) / 2), (o.y + o.h / 2) * CH],
		];
		for (const [ty, px] of candY) {
			const diff = Math.abs(ty - s.y);
			if (diff <= 1 && (!bestY || diff < bestY.diff))
				bestY = { diff, y: ty, guide: { axis: "h", px } };
		}
	}
	const guides: Guide[] = [];
	if (bestX) {
		s.x = clamp(bestX.x, 0, MAX_COLS - s.w);
		guides.push(bestX.guide);
	}
	if (bestY) {
		s.y = clamp(bestY.y, 0, MAX_ROWS - s.h);
		guides.push(bestY.guide);
	}
	return guides;
}

/** Bottom-right extent of all content, in cells (exclusive bounds). */
export function contentExtent(shapes: Shape[]): { x: number; y: number } {
	let x = 0,
		y = 0;
	for (const s of shapes) {
		if (s.type === "box" || s.type === "group") {
			x = Math.max(x, s.x + s.w);
			y = Math.max(y, s.y + s.h);
		} else if (s.type === "text") {
			const lines = (s.text || "").split("\n");
			x = Math.max(x, s.x + Math.max(...lines.map((l) => l.length)));
			y = Math.max(y, s.y + lines.length);
		} else {
			// labels render centered on the path; give them slack
			const labelHalf = s.text
				? (Math.max(...s.text.split("\n").map((l) => l.length)) >> 1) + 2
				: 1;
			x = Math.max(x, Math.max(s.x1, s.x2) + labelHalf);
			y = Math.max(
				y,
				Math.max(s.y1, s.y2) + (s.text ? s.text.split("\n").length : 0) + 1,
			);
		}
	}
	return { x, y };
}

/** Is `s` geometrically inside group `g` (fully within the frame)? */
export function insideGroup(s: Shape, g: GroupShape): boolean {
	const inRect = (x: number, y: number) =>
		x > g.x && x < g.x + g.w - 1 && y > g.y && y < g.y + g.h - 1;
	if (s.type === "box" || s.type === "group")
		return (
			s.id !== g.id && inRect(s.x, s.y) && inRect(s.x + s.w - 1, s.y + s.h - 1)
		);
	if (s.type === "text") return inRect(s.x, s.y);
	// Arrows ride along when their free endpoints are inside; attached
	// endpoints follow their boxes regardless.
	return (
		(s.box1 != null || inRect(s.x1, s.y1)) &&
		(s.box2 != null || inRect(s.x2, s.y2))
	);
}
