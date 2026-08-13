import { render } from './render';
import { placeFrom } from './shapes';
import { app, getShape, pushUndo, save } from './store';

/* ============================================================
 * Selection-level commands shared by toolbar and keyboard.
 * ============================================================ */

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
