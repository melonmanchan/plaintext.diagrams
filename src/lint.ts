import { routeAll } from "./raster";
import { insideGroup } from "./shapes";
import type { ArrowShape, BoxShape, GroupShape, Shape } from "./types";

/* ============================================================
 * Layout lint — actionable crowding diagnostics for generated
 * diagrams. Pure over the shapes array; used by the render CLI
 * so a generator can fix its JSON and re-render until clean.
 * ============================================================ */

export interface LintIssue {
	code:
		| "box-overlap"
		| "group-crossing"
		| "group-hug"
		| "group-overlap"
		| "arrow-overdraw"
		| "arrow-rail"
		| "label-squeezed";
	msg: string;
}

/** Human handle for a shape: first line of its text, else its id. */
function tag(s: { id: number; text?: string }, kind: string): string {
	const t = s.text?.split("\n")[0].trim();
	return t ? `${kind} '${t}'` : `${kind} #${s.id}`;
}

const intersects = (
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
): boolean =>
	a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Empty cells between two disjoint rects (max over the separating axes). */
const clearance = (
	a: { x: number; y: number; w: number; h: number },
	b: { x: number; y: number; w: number; h: number },
): number =>
	Math.max(
		b.x - (a.x + a.w),
		a.x - (b.x + b.w),
		b.y - (a.y + a.h),
		a.y - (b.y + b.h),
	);

export function lintShapes(shapes: Shape[]): LintIssue[] {
	const issues: LintIssue[] = [];
	const boxes = shapes.filter((s): s is BoxShape => s.type === "box");
	const groups = shapes.filter((s): s is GroupShape => s.type === "group");

	for (let i = 0; i < boxes.length; i++)
		for (let j = i + 1; j < boxes.length; j++)
			if (intersects(boxes[i], boxes[j]))
				issues.push({
					code: "box-overlap",
					msg: `${tag(boxes[i], "box")} and ${tag(boxes[j], "box")} overlap — separate them`,
				});

	for (const b of boxes)
		for (const g of groups) {
			if (intersects(b, g)) {
				if (!insideGroup(b, g))
					issues.push({
						code: "group-crossing",
						msg: `${tag(b, "box")} crosses the frame of ${tag(g, "group")} — move it fully inside (≥1 cell from the border) or ≥2 cells outside`,
					});
			} else if (clearance(b, g) < 2)
				issues.push({
					code: "group-hug",
					msg: `${tag(b, "box")} sits within 2 cells of ${tag(g, "group")}'s frame — keep ≥2 cells of clearance outside a frame it doesn't belong to`,
				});
		}

	for (let i = 0; i < groups.length; i++)
		for (let j = i + 1; j < groups.length; j++) {
			const a = groups[i],
				b = groups[j];
			if (intersects(a, b) && !insideGroup(a, b) && !insideGroup(b, a))
				issues.push({
					code: "group-overlap",
					msg: `${tag(a, "group")} and ${tag(b, "group")} overlap without nesting — nest one fully inside the other or separate them`,
				});
		}

	// resolveArrow writes resolved anchors back into attached arrows; lint
	// must stay pure, so route shallow clones of the arrows instead.
	const routed = routeAll(
		shapes.map((s) => (s.type === "arrow" ? { ...s } : s)),
	);
	const endName = (id: number | null): string => {
		const b = id != null ? boxes.find((x) => x.id === id) : undefined;
		return b ? tag(b, "box") : "a free endpoint";
	};
	for (const a of shapes.filter((s): s is ArrowShape => s.type === "arrow")) {
		const r = routed.get(a.id);
		if (!r) continue;
		const ends = `${endName(a.box1)} → ${endName(a.box2)}`;
		if (r.dirty)
			issues.push({
				code: "arrow-overdraw",
				msg: `arrow #${a.id} (${ends}) overdraws a box — no clear route exists; move the endpoints apart or clear a corridor between them`,
			});
		// A single shared cell is a benign touch (e.g. a bend); longer runs
		// merge into one ambiguous rail.
		if ((r.rails ?? 0) > 1)
			issues.push({
				code: "arrow-rail",
				msg: `arrow #${a.id} (${ends}) rides on top of another arrow for ${r.rails} cells — give each arrow its own corridor`,
			});
		if (r.squeezed && a.text) {
			const need = Math.max(...a.text.split("\n").map((l) => l.length)) + 4;
			issues.push({
				code: "label-squeezed",
				msg: `label '${a.text.split("\n")[0]}' of arrow #${a.id} (${ends}) has no collision-free spot — leave a clear run of ≥${need} cells along the arrow`,
			});
		}
	}
	return issues;
}
