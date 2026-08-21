import * as dagre from "@dagrejs/dagre";
import { MAX_COLS, MAX_ROWS } from "./constants";
import { insideGroup, snapBox } from "./shapes";
import type { BoxShape, GroupShape, Shape } from "./types";
import { clamp } from "./util";

/* ============================================================
 * Auto-layout (dagre, layered LR) and Tidy (batch snap).
 * Pure over the shapes array — mutates positions only.
 * ============================================================ */

function translate(s: Shape, dx: number, dy: number): void {
	if (s.type === "arrow") {
		// Free endpoints move; attached ones re-anchor on render.
		if (s.box1 == null) {
			s.x1 += dx;
			s.y1 += dy;
		}
		if (s.box2 == null) {
			s.x2 += dx;
			s.y2 += dy;
		}
	} else {
		s.x += dx;
		s.y += dy;
	}
}

/**
 * Layered left-to-right layout of boxes and group frames.
 * Groups are rigid units: their contents ride along unchanged.
 * Free text is left in place; arrows re-route automatically.
 * With `only`, just those shapes participate and the arranged
 * result stays anchored at the selection's original corner.
 */
export function autoLayout(shapes: Shape[], only?: ReadonlySet<number>): void {
	const pick = (id: number) => !only || only.has(id);
	const groups = shapes.filter((s): s is GroupShape => s.type === "group");
	// Nodes: top-level groups + boxes not inside any of them.
	const nodes: (BoxShape | GroupShape)[] = groups.filter(
		(g) =>
			pick(g.id) &&
			!groups.some((o) => o !== g && pick(o.id) && insideGroup(g, o)),
	);
	const nodeOf = new Map<number, number>(); // box id → owning node id
	for (const s of shapes) {
		if (s.type !== "box") continue;
		const owner = nodes.find((n) => n.type === "group" && insideGroup(s, n));
		if (owner) {
			nodeOf.set(s.id, owner.id);
		} else if (pick(s.id)) {
			nodes.push(s);
			nodeOf.set(s.id, s.id);
		}
	}
	if (nodes.length < 2) return;

	const g = new dagre.graphlib.Graph();
	g.setGraph({
		rankdir: "LR",
		nodesep: 3,
		ranksep: 12,
		marginx: 2,
		marginy: 1,
	});
	g.setDefaultEdgeLabel(() => ({}));
	for (const n of nodes) g.setNode(String(n.id), { width: n.w, height: n.h });
	for (const s of shapes) {
		if (s.type !== "arrow" || s.box1 == null || s.box2 == null) continue;
		const a = nodeOf.get(s.box1),
			b = nodeOf.get(s.box2);
		if (a == null || b == null || a === b) continue;
		g.setEdge(String(a), String(b));
	}
	dagre.layout(g);

	// Capture group contents before anything moves (avoid double shifts).
	const carried = new Map<number, Shape[]>();
	for (const n of nodes) {
		if (n.type !== "group") continue;
		carried.set(
			n.id,
			shapes.filter((s) => s.id !== n.id && insideGroup(s, n)),
		);
	}

	// Target positions first, so a selection can be re-anchored at its
	// original top-left corner instead of jumping to the canvas origin.
	const targets = new Map<number, { x: number; y: number }>();
	for (const n of nodes) {
		const pos = g.node(String(n.id));
		if (pos)
			targets.set(n.id, {
				x: Math.round(pos.x - n.w / 2),
				y: Math.round(pos.y - n.h / 2),
			});
	}
	let shiftX = 0,
		shiftY = 0;
	const placed = nodes.filter((n) => targets.has(n.id));
	if (only && placed.length) {
		shiftX =
			Math.min(...placed.map((n) => n.x)) -
			Math.min(...placed.map((n) => targets.get(n.id)?.x));
		shiftY =
			Math.min(...placed.map((n) => n.y)) -
			Math.min(...placed.map((n) => targets.get(n.id)?.y));
	}

	// Nodes that all live inside one group must stay inside it: anchor
	// the arrangement within the frame's interior, then grow the frame
	// if the new arrangement needs more room.
	const host = only
		? groups.find(
				(h) => !only.has(h.id) && placed.every((n) => insideGroup(n, h)),
			)
		: undefined;
	if (host && placed.length) {
		const top = host.y + (host.text ? 2 : 0);
		const minTx = Math.min(...placed.map((n) => targets.get(n.id)?.x)) + shiftX;
		const minTy = Math.min(...placed.map((n) => targets.get(n.id)?.y)) + shiftY;
		shiftX += Math.max(0, host.x + 3 - minTx);
		shiftY += Math.max(0, top + 2 - minTy);
	}

	for (const n of nodes) {
		const t = targets.get(n.id);
		if (!t) continue;
		const nx = clamp(t.x + shiftX, 0, MAX_COLS - n.w);
		const ny = clamp(t.y + shiftY, 0, MAX_ROWS - n.h);
		const dx = nx - n.x,
			dy = ny - n.y;
		if (dx === 0 && dy === 0) continue;
		for (const s of carried.get(n.id) ?? []) translate(s, dx, dy);
		n.x = nx;
		n.y = ny;
	}

	if (host && placed.length) {
		const maxX = Math.max(...placed.map((n) => n.x + n.w));
		const maxY = Math.max(...placed.map((n) => n.y + n.h));
		host.w = Math.max(host.w, Math.min(MAX_COLS - host.x, maxX - host.x + 3));
		host.h = Math.max(host.h, Math.min(MAX_ROWS - host.y, maxY - host.y + 2));
	}
}

/**
 * Conservative formatter: batch-snap every box and group frame to
 * near-aligned (±1 cell) edges/centers of its peers. Never changes
 * topology or ordering — safe on hand-arranged diagrams.
 */
export function tidy(shapes: Shape[], only?: ReadonlySet<number>): void {
	for (const s of shapes) {
		if (only && !only.has(s.id)) continue;
		if (s.type === "box" || s.type === "group") snapBox(s, shapes);
	}
}
