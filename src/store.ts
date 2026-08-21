import {
	COLS,
	DOC_KEY,
	MAX_ZOOM,
	MIN_ZOOM,
	ROWS,
	STORE_INDEX,
	ZOOM_KEY,
} from "./constants";
import type {
	DocState,
	Drag,
	Guide,
	Project,
	Raster,
	Shape,
	Tool,
} from "./types";
import { clamp } from "./util";

/* ============================================================
 * Central mutable state + persistence. No DOM, no rendering —
 * callers re-render after mutating.
 * ============================================================ */

export const app = {
	doc: { seq: 1, shapes: [] } as DocState,
	tool: "select" as Tool,
	selection: new Set<number>(),
	hoverId: null as number | null,
	/** Shape id under inline text edit (editor.ts owns the textarea). */
	editing: null as number | null,
	/** Lane index under edit when the edited shape is a swimlane group. */
	editingLane: null as number | null,
	drag: null as Drag | null,
	/** Last raster; render.ts writes it, hit-testing reads it. */
	grid: null as Raster | null,
	undoStack: [] as string[],
	redoStack: [] as string[],
	projects: [] as Project[],
	currentProject: "",
	/** View zoom factor; world px × zoom = screen px. */
	zoom: 1,
	/** Last hovered cell — paste anchor. */
	mouseCell: null as { x: number; y: number } | null,
	/** Active snap-alignment guides while dragging. */
	guides: [] as Guide[],
	/** Current world size in cells; grows/shrinks with content. */
	world: { cols: COLS, rows: ROWS },
};

export const uid = () => app.doc.seq++;

export const getShape = (id: number): Shape | null =>
	app.doc.shapes.find((s) => s.id === id) ?? null;

/** The single selected shape, or null when 0 or 2+ are selected. */
export const soleSel = (): Shape | null =>
	app.selection.size === 1
		? getShape(app.selection.values().next().value as number)
		: null;

export const snapshot = () => JSON.stringify(app.doc);

export function pushUndo(snap?: string): void {
	app.undoStack.push(snap ?? snapshot());
	if (app.undoStack.length > 200) app.undoStack.shift();
	app.redoStack.length = 0;
}

export function undo(): void {
	if (!app.undoStack.length) return;
	app.redoStack.push(snapshot());
	app.doc = JSON.parse(app.undoStack.pop()!);
	app.selection = new Set();
	app.hoverId = null;
	save();
}

export function redo(): void {
	if (!app.redoStack.length) return;
	app.undoStack.push(snapshot());
	app.doc = JSON.parse(app.redoStack.pop()!);
	app.selection = new Set();
	app.hoverId = null;
	save();
}

/* ---------- persistence ---------- */

export function save(): void {
	try {
		localStorage.setItem(DOC_KEY(app.currentProject), snapshot());
		localStorage.setItem(
			STORE_INDEX,
			JSON.stringify({ projects: app.projects, current: app.currentProject }),
		);
	} catch {
		/* private mode / quota */
	}
	persistHistory();
}

const HIST_KEY = (id: string) => `ptd:hist:${id}`;

export function persistZoom(): void {
	try {
		localStorage.setItem(ZOOM_KEY, String(app.zoom));
	} catch {
		/* ignore */
	}
}

export function loadZoom(): void {
	try {
		const raw = localStorage.getItem(ZOOM_KEY);
		if (raw == null) return;
		const z = Number(raw);
		if (Number.isFinite(z)) app.zoom = clamp(z, MIN_ZOOM, MAX_ZOOM);
	} catch {
		/* storage unavailable */
	}
}

function persistHistory(): void {
	const payload = (n: number) =>
		JSON.stringify({
			undo: app.undoStack.slice(-n),
			redo: app.redoStack.slice(-n),
		});
	try {
		localStorage.setItem(HIST_KEY(app.currentProject), payload(100));
	} catch {
		// quota: retry with a short tail, else live without persisted history
		try {
			localStorage.setItem(HIST_KEY(app.currentProject), payload(15));
		} catch {
			/* ignore */
		}
	}
}

/** Restore the persisted undo/redo stacks for a project. */
export function loadHistory(id: string): void {
	app.undoStack = [];
	app.redoStack = [];
	try {
		const h = JSON.parse(localStorage.getItem(HIST_KEY(id)) ?? "null");
		if (h && Array.isArray(h.undo) && Array.isArray(h.redo)) {
			app.undoStack = h.undo.filter(
				(s: unknown): s is string => typeof s === "string",
			);
			app.redoStack = h.redo.filter(
				(s: unknown): s is string => typeof s === "string",
			);
		}
	} catch {
		/* corrupt entry */
	}
}

/** Remove a project's persisted history. */
export function dropHistory(id: string): void {
	try {
		localStorage.removeItem(HIST_KEY(id));
	} catch {
		/* ignore */
	}
}

export function loadDoc(id: string): DocState | null {
	try {
		const s = JSON.parse(localStorage.getItem(DOC_KEY(id)) ?? "null");
		if (!s || !Array.isArray(s.shapes)) return null;
		for (const sh of s.shapes) {
			if (sh.type === "arrow" && "dual" in sh) {
				// pre-heads documents stored `dual: boolean`
				if (sh.dual) sh.heads = "both";
				delete sh.dual;
			}
		}
		return s;
	} catch {
		return null;
	}
}

export const genId = () =>
	Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Reset per-document view state (selection, hover, undo, drag). */
export function resetView(): void {
	app.selection = new Set();
	app.hoverId = null;
	app.undoStack = [];
	app.redoStack = [];
	app.drag = null;
}
