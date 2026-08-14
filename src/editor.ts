import { CH, CW, FONT, MAX_COLS, MAX_ROWS } from './constants';
import { pathMidpoint, resolveArrow } from './raster';
import { ctx, render } from './render';
import { boxMinSize, fitBoxToLabel } from './shapes';
import { app, getShape, pushUndo, save, snapshot } from './store';
import type { BoxShape, Shape } from './types';
import { clamp } from './util';

/* ============================================================
 * Inline label editing via a grid-aligned textarea overlay.
 * ============================================================ */

let editorEl: HTMLTextAreaElement | null = null;
let editSnap: string | null = null;

export function startEdit(s: Shape, seed?: string): void {
  commitEdit();
  app.editing = s.id;
  editSnap = snapshot();
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = seed ?? s.text ?? '';
  ta.style.font = FONT;
  ta.style.lineHeight = CH + 'px';
  ctx.font = FONT;
  ta.style.letterSpacing = (CW - ctx.measureText('M').width).toFixed(2) + 'px';

  if (s.type === 'box') {
    ta.style.left = (s.x + 1) * CW + 'px';
    ta.style.top = (s.y + 1) * CH + 'px';
    ta.style.textAlign = 'center';
    const ow = s.w, oh = s.h;
    // Grow the box live while typing (never below its pre-edit size).
    const sync = () => {
      const b = getShape(s.id);
      if (!b || b.type !== 'box') return;
      const [minW, minH] = boxMinSize({ ...b, text: ta.value });
      const w = Math.min(Math.max(ow, minW), MAX_COLS - b.x);
      const h = Math.min(Math.max(oh, minH), MAX_ROWS - b.y);
      if (w !== b.w || h !== b.h) {
        b.w = w;
        b.h = h;
        render();
      }
      const iw = Math.max(1, b.w - 2), ih = Math.max(1, b.h - 2);
      ta.style.width = iw * CW + 'px';
      ta.style.height = ih * CH + 'px';
      const n = ta.value.split('\n').length;
      ta.style.paddingTop = Math.max(0, (ih - n) >> 1) * CH + 'px';
    };
    ta.addEventListener('input', sync);
    sync();
  } else {
    const at = s.type === 'arrow'
      ? pathMidpoint(resolveArrow(s, app.doc.shapes).pts)
      : { x: s.x, y: s.y };
    const ox = at.x, oy = at.y;
    ta.style.left = ox * CW + 'px';
    ta.style.top = oy * CH + 'px';
    const fit = () => {
      const lines = ta.value.split('\n');
      const wch = Math.max(8, ...lines.map((l) => l.length)) + 2;
      ta.style.width = wch * CW + 'px';
      ta.style.height = Math.max(1, lines.length) * CH + 4 + 'px';
    };
    ta.addEventListener('input', fit);
    fit();
    // Double-click inside a free-text editor: promote the text to a box.
    if (s.type === 'text') {
      ta.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        promoteToBox(s.id, ta.value);
      });
    }
  }

  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commitEdit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });
  ta.addEventListener('blur', () => commitEdit());

  // The overlay is laid out in world px; scale it to match the zoomed canvas.
  if (app.zoom !== 1) {
    ta.style.transformOrigin = '0 0';
    ta.style.transform = `scale(${app.zoom})`;
    ta.style.left = parseFloat(ta.style.left) * app.zoom + 'px';
    ta.style.top = parseFloat(ta.style.top) * app.zoom + 'px';
  }

  document.querySelector('#world')!.appendChild(ta);
  editorEl = ta;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  render();
}

/** Replace a text shape with a box labelled with the editor's content. */
function promoteToBox(id: number, raw: string): void {
  const t = getShape(id);
  if (!t || t.type !== 'text') return;
  const caret = editorEl?.selectionStart ?? raw.length;
  pushUndo(editSnap ?? undefined);
  const b: BoxShape = {
    type: 'box',
    id: t.id,
    // Keep the label glyphs roughly where the text sat (border + padding offset).
    x: clamp(t.x - 3, 0, MAX_COLS - 3),
    y: clamp(t.y - 1, 0, MAX_ROWS - 3),
    w: 3,
    h: 3,
    text: raw.replace(/[ \t]+$/gm, '').replace(/\n+$/, ''),
  };
  fitBoxToLabel(b);
  app.doc.shapes[app.doc.shapes.indexOf(t)] = b;
  teardownEditor();
  app.selection = new Set([b.id]);
  save();
  render();
  startEdit(b);
  editorEl?.setSelectionRange(caret, caret);
}

export function commitEdit(): void {
  if (app.editing == null || !editorEl) return;
  const s = getShape(app.editing);
  const value = editorEl.value.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  teardownEditor();
  if (s) {
    const changed = (s.text ?? '') !== value;
    if (s.type === 'text' && !value) {
      pushUndo(editSnap ?? undefined);
      app.doc.shapes = app.doc.shapes.filter((sh) => sh.id !== s.id);
      app.selection.delete(s.id);
    } else if (changed) {
      pushUndo(editSnap ?? undefined);
      s.text = value;
      if (s.type === 'box') fitBoxToLabel(s);
    }
  }
  editSnap = null;
  save();
  render();
}

export function cancelEdit(): void {
  if (app.editing == null) return;
  const id = app.editing;
  teardownEditor();
  // Revert any live box growth (and uncommitted state) from this session.
  if (editSnap) app.doc = JSON.parse(editSnap);
  const s = getShape(id);
  if (s && s.type === 'text' && !s.text) {
    app.doc.shapes = app.doc.shapes.filter((sh) => sh.id !== s.id);
    app.selection.delete(s.id);
  }
  editSnap = null;
  render();
}

function teardownEditor(): void {
  app.editing = null;
  if (editorEl) {
    const el = editorEl;
    editorEl = null;
    el.remove();
  }
}
