import { render } from './render';
import { placeFrom } from './shapes';
import { app, getShape, pushUndo, save } from './store';
import type { ArrowShape, Shape, Side } from './types';

/* ============================================================
 * Selection-level commands shared by toolbar and keyboard.
 * ============================================================ */


/** Cycle head placement (end → both → start) on all selected arrows. */
export function cycleArrowHeads(): boolean {
  const arrows = [...app.selection]
    .map(getShape)
    .filter((s): s is ArrowShape => s?.type === 'arrow');
  if (!arrows.length) return false;
  pushUndo();
  for (const a of arrows)
    a.heads = (a.heads ?? 'end') === 'end' ? 'both' : a.heads === 'both' ? 'start' : 'end';
  save();
  render();
  return true;
}

const SIDE_CYCLE: (Side | undefined)[] = [undefined, 'left', 'right', 'top', 'bottom'];

/**
 * Cycle the pinned anchor side of one endpoint on the sole selected arrow:
 * auto → left → right → top → bottom → auto. Pins need an attached box.
 */
export function cycleArrowSide(which: 1 | 2): boolean {
  const sel = [...app.selection].map(getShape).filter((s): s is ArrowShape => s?.type === 'arrow');
  if (sel.length !== 1) return false;
  const a = sel[0];
  if ((which === 1 ? a.box1 : a.box2) == null) return false;
  pushUndo();
  const key = which === 1 ? 'side1' : 'side2';
  const next = SIDE_CYCLE[(SIDE_CYCLE.indexOf(a[key]) + 1) % SIDE_CYCLE.length];
  if (next === undefined) delete a[key];
  else a[key] = next;
  // an exact offset along the previous side is meaningless on the new one
  delete a[which === 1 ? 'at1' : 'at2'];
  save();
  render();
  return true;
}

/**
 * Toggle the kind-appropriate variant on every selected shape:
 * arrows dash, boxes round, groups cycle swimlanes (none→2→…→5→none).
 */
export function cycleStyle(): boolean {
  const targets = [...app.selection]
    .map(getShape)
    .filter((s): s is Shape => s != null && s.type !== 'text');
  if (!targets.length) return false;
  pushUndo();
  for (const s of targets) {
    if (s.type === 'arrow') s.style = s.style === 'dashed' ? undefined : 'dashed';
    else if (s.type === 'box') s.style = s.style === 'round' ? undefined : 'round';
    else if (s.type === 'group') {
      const n = s.lanes?.length ?? 0;
      const next = n === 0 ? 2 : n >= 5 ? 0 : n + 1;
      s.lanes = next === 0
        ? undefined
        : Array.from({ length: next }, (_, i) => s.lanes?.[i] ?? 'Lane ' + (i + 1));
    }
  }
  save();
  render();
  return true;
}

export function deleteSelected(): void {
  if (!app.selection.size) return;
  pushUndo();
  for (const s of app.doc.shapes) {
    if (s.type !== 'arrow' || app.selection.has(s.id)) continue;
    // Detached endpoints keep their last resolved anchor coordinates.
    if (s.box1 != null && app.selection.has(s.box1)) s.box1 = null;
    if (s.box2 != null && app.selection.has(s.box2)) s.box2 = null;
  }
  app.doc.shapes = app.doc.shapes.filter((sh) => !app.selection.has(sh.id));
  app.selection = new Set();
  save();
  render();
}

export function nudge(dx: number, dy: number): void {
  if (!app.selection.size) return;
  pushUndo();
  for (const id of app.selection) {
    const s = getShape(id);
    if (s) placeFrom(s, s, dx, dy, app.doc.shapes);
  }
  save();
  render();
}

export function clearAll(): void {
  if (!app.doc.shapes.length) return;
  if (!confirm('Clear the whole canvas?')) return;
  pushUndo();
  app.doc.shapes = [];
  app.selection = new Set();
  save();
  render();
}
