import { CH, CW, MAX_COLS, MAX_ROWS } from './constants';
import { cycleArrowHeads } from './commands';
import { commitEdit, startEdit } from './editor';
import { render } from './render';
import { boxAt, boxAttachAt, boxHandles, boxMinSize, onBoxBorder, placeFrom, snapBox } from './shapes';
import { app, getShape, pushUndo, save, snapshot, soleSel, uid } from './store';
import type { ArrowShape, BoxShape, Corner, Shape, TextShape } from './types';
import { hintText, setTool } from './ui';
import { clamp, clone } from './util';

/* ============================================================
 * Pointer interactions: hit-testing, drag state machine, cursor.
 * ============================================================ */

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;

function cellAt(px: number, py: number): { x: number; y: number } {
  return {
    x: clamp(Math.floor(px / CW), 0, app.world.cols - 1),
    y: clamp(Math.floor(py / CH), 0, app.world.rows - 1),
  };
}

function eventPos(e: MouseEvent): { px: number; py: number } {
  const r = canvas.getBoundingClientRect();
  // Map screen px to world (cell-px) space.
  return { px: (e.clientX - r.left) / app.zoom, py: (e.clientY - r.top) / app.zoom };
}

function shapeIdAt(cx: number, cy: number): number | null {
  if (!app.grid) return null;
  return app.grid.id[cy * app.grid.cols + cx] || null;
}

function handleAt(px: number, py: number, s: BoxShape): Corner | null {
  for (const h of boxHandles(s))
    if (Math.abs(px - h.px) <= 7 && Math.abs(py - h.py) <= 7) return h.c;
  return null;
}

function endpointAt(px: number, py: number, s: ArrowShape): 1 | 2 | null {
  const d1 = Math.hypot(px - (s.x1 * CW + CW / 2), py - (s.y1 * CH + CH / 2));
  const d2 = Math.hypot(px - (s.x2 * CW + CW / 2), py - (s.y2 * CH + CH / 2));
  if (d2 <= 9 && d2 <= d1) return 2;
  if (d1 <= 9) return 1;
  return null;
}

/** Default-sized empty box centered on a cell, clamped to the canvas. */
function quickBox(cx: number, cy: number): BoxShape {
  const w = 12, h = 5;
  return {
    type: 'box',
    id: uid(),
    x: clamp(cx - (w >> 1), 0, MAX_COLS - w),
    y: clamp(cy - (h >> 1), 0, MAX_ROWS - h),
    w, h,
    text: '',
  };
}

// Middle-button pan state (view-level, outside the shape drag machine).
let pan: { sx: number; sy: number; left: number; top: number } | null = null;

function onMouseDown(e: MouseEvent): void {
  if (e.button !== 0 && e.button !== 1) return;
  if (app.editing != null) commitEdit();
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);

  // Middle button: pan the viewport.
  if (e.button === 1) {
    e.preventDefault(); // suppress autoscroll
    const stage = document.querySelector<HTMLElement>('#stage')!;
    pan = { sx: e.clientX, sy: e.clientY, left: stage.scrollLeft, top: stage.scrollTop };
    canvas.style.cursor = 'grabbing';
    return;
  }

  // Cmd/Ctrl+click: drop a new box centered on the cursor, in any tool.
  if (e.metaKey || e.ctrlKey) {
    e.preventDefault(); // suppress native modifier behavior
    const snap = snapshot();
    const b = quickBox(cx, cy);
    app.doc.shapes.push(b);
    pushUndo(snap);
    app.selection = new Set([b.id]);
    setTool('select');
    save();
    render();
    return;
  }


  if (app.tool === 'select') {
    const sel = soleSel();
    if (sel && sel.type === 'box') {
      const corner = handleAt(px, py, sel);
      if (corner) {
        app.drag = { mode: 'resize', id: sel.id, corner, orig: clone(sel), snap: snapshot(), moved: false };
        return;
      }
      // Drag from a selected box's border starts a new arrow attached to it.
      if (!e.shiftKey && onBoxBorder(sel, cx, cy)) {
        const id = uid();
        app.doc.shapes.push({ type: 'arrow', id, x1: cx, y1: cy, x2: cx, y2: cy, box1: sel.id, box2: null });
        app.drag = { mode: 'create-arrow', id, snap: snapshot(), moved: false };
        render();
        return;
      }
    }
    if (sel && sel.type === 'arrow') {
      const which = endpointAt(px, py, sel);
      if (which) {
        app.drag = { mode: 'endpoint', id: sel.id, which, snap: snapshot(), moved: false };
        return;
      }
    }
    const hit = shapeIdAt(cx, cy);
    if (hit) {
      if (e.shiftKey) {
        if (app.selection.has(hit)) app.selection.delete(hit);
        else app.selection.add(hit);
      } else {
        if (!app.selection.has(hit)) app.selection = new Set([hit]);
        const orig = new Map<number, Shape>();
        for (const id of app.selection) {
          const s = getShape(id);
          if (s) orig.set(id, clone(s));
        }
        app.drag = { mode: 'move', sx: cx, sy: cy, orig, snap: snapshot(), moved: false };
      }
    } else {
      const base = e.shiftKey ? new Set(app.selection) : new Set<number>();
      if (!e.shiftKey) app.selection = new Set();
      app.drag = { mode: 'marquee', sx: cx, sy: cy, cx, cy, base, moved: false };
    }
    render();
  } else if (app.tool === 'box') {
    app.drag = { mode: 'create-box', sx: cx, sy: cy, id: null, snap: snapshot(), moved: false };
  } else if (app.tool === 'arrow') {
    const id = uid();
    const b = boxAttachAt(app.doc.shapes, cx, cy);
    app.doc.shapes.push({ type: 'arrow', id, x1: cx, y1: cy, x2: cx, y2: cy, box1: b ? b.id : null, box2: null });
    app.drag = { mode: 'create-arrow', id, snap: snapshot(), moved: false };
    render();
  } else if (app.tool === 'text') {
    const snap = snapshot();
    const id = uid();
    const t: TextShape = { type: 'text', id, x: cx, y: cy, text: '' };
    app.doc.shapes.push(t);
    pushUndo(snap);
    app.selection = new Set([id]);
    setTool('select');
    render();
    startEdit(t);
  }
}

function onMouseMove(e: MouseEvent): void {
  if (pan) {
    const stage = document.querySelector<HTMLElement>('#stage')!;
    stage.scrollLeft = pan.left - (e.clientX - pan.sx);
    stage.scrollTop = pan.top - (e.clientY - pan.sy);
    return;
  }
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);
  document.querySelector('#hint')!.textContent = hintText(cx, cy);
  app.mouseCell = { x: cx, y: cy };

  const d = app.drag;
  if (!d) {
    updateCursor(px, py, cx, cy);
    return;
  }
  d.moved = true;

  if (d.mode === 'move') {
    const dx = cx - d.sx, dy = cy - d.sy;
    for (const [id, o] of d.orig) {
      const s = getShape(id);
      if (s) placeFrom(s, o, dx, dy, app.doc.shapes);
    }
    app.guides = [];
    if (!e.altKey && d.orig.size === 1) {
      const only = getShape(d.orig.keys().next().value as number);
      if (only && only.type === 'box') app.guides = snapBox(only, app.doc.shapes);
    }
  } else if (d.mode === 'marquee') {
    d.cx = cx;
    d.cy = cy;
    const x1 = Math.min(d.sx, cx), x2 = Math.max(d.sx, cx);
    const y1 = Math.min(d.sy, cy), y2 = Math.max(d.sy, cy);
    const next = new Set(d.base);
    if (app.grid)
      for (let y = y1; y <= y2; y++)
        for (let x = x1; x <= x2; x++) {
          const sid = app.grid.id[y * app.grid.cols + x];
          if (sid) next.add(sid);
        }
    app.selection = next;
  } else if (d.mode === 'resize') {
    const s = getShape(d.id);
    if (!s || s.type !== 'box') return;
    const o = d.orig;
    const [minW, minH] = boxMinSize(s);
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w - 1, y2 = o.y + o.h - 1;
    if (d.corner.includes('w')) x1 = Math.min(cx, x2 - (minW - 1));
    if (d.corner.includes('e')) x2 = Math.max(cx, x1 + (minW - 1));
    if (d.corner.includes('n')) y1 = Math.min(cy, y2 - (minH - 1));
    if (d.corner.includes('s')) y2 = Math.max(cy, y1 + (minH - 1));
    s.x = clamp(x1, 0, MAX_COLS - minW);
    s.y = clamp(y1, 0, MAX_ROWS - minH);
    s.w = x2 - s.x + 1;
    s.h = y2 - s.y + 1;
  } else if (d.mode === 'endpoint') {
    const s = getShape(d.id);
    if (!s || s.type !== 'arrow') return;
    const b = boxAttachAt(app.doc.shapes, cx, cy);
    if (d.which === 1) {
      s.x1 = cx;
      s.y1 = cy;
      s.box1 = b && b.id !== s.box2 ? b.id : null;
    } else {
      s.x2 = cx;
      s.y2 = cy;
      s.box2 = b && b.id !== s.box1 ? b.id : null;
    }
  } else if (d.mode === 'create-box') {
    let s = d.id != null ? getShape(d.id) : null;
    if (!s) {
      s = { type: 'box', id: uid(), x: d.sx, y: d.sy, w: 3, h: 3, text: '' };
      app.doc.shapes.push(s);
      d.id = s.id;
    }
    if (s.type !== 'box') return;
    s.x = Math.min(d.sx, cx);
    s.y = Math.min(d.sy, cy);
    s.w = Math.max(3, Math.abs(cx - d.sx) + 1);
    s.h = Math.max(3, Math.abs(cy - d.sy) + 1);
  } else if (d.mode === 'create-arrow') {
    const s = getShape(d.id);
    if (!s || s.type !== 'arrow') return;
    const b = boxAttachAt(app.doc.shapes, cx, cy);
    s.x2 = cx;
    s.y2 = cy;
    s.box2 = b && b.id !== s.box1 ? b.id : null;
  }
  render();
}

function onMouseUp(): void {
  if (pan) {
    pan = null;
    canvas.style.cursor = 'default';
    return;
  }
  const d = app.drag;
  if (!d) return;
  app.drag = null;
  app.guides = [];

  if (d.mode === 'create-box') {
    if (d.id != null) {
      pushUndo(d.snap);
      app.selection = new Set([d.id]);
      setTool('select');
    }
  } else if (d.mode === 'create-arrow') {
    const s = getShape(d.id);
    const degenerate =
      !d.moved || !s || s.type !== 'arrow' || (s.x1 === s.x2 && s.y1 === s.y2 && !s.box2);
    if (degenerate) {
      app.doc.shapes = app.doc.shapes.filter((sh) => sh.id !== d.id);
    } else {
      pushUndo(d.snap);
      if (s.box1 != null && s.box2 == null) {
        // Box-sourced arrow dropped on empty canvas: create the target box.
        const b = quickBox(s.x2, s.y2);
        app.doc.shapes.push(b);
        s.box2 = b.id;
        app.selection = new Set([b.id]); // select the new box → type to label it
      } else {
        app.selection = new Set([d.id]);
      }
      setTool('select');
    }
  } else if (d.moved && d.mode !== 'marquee') {
    pushUndo(d.snap);
  }
  save();
  render();
}

function onDblClick(e: MouseEvent): void {
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);
  const hit = shapeIdAt(cx, cy);
  const s = hit != null ? getShape(hit) : null;
  if (s) {
    app.selection = new Set([s.id]);
    render();
    startEdit(s);
  } else {
    const snap = snapshot();
    const t: TextShape = { type: 'text', id: uid(), x: cx, y: cy, text: '' };
    app.doc.shapes.push(t);
    pushUndo(snap);
    app.selection = new Set([t.id]);
    render();
    startEdit(t);
  }
}

function updateCursor(px: number, py: number, cx: number, cy: number): void {
  let cur = 'default';
  if (app.tool === 'box' || app.tool === 'arrow') cur = 'crosshair';
  else if (app.tool === 'text') cur = 'text';
  else {
    const sel = soleSel();
    if (sel && sel.type === 'box') {
      const c = handleAt(px, py, sel);
      if (c === 'nw' || c === 'se') cur = 'nwse-resize';
      else if (c === 'ne' || c === 'sw') cur = 'nesw-resize';
      else if (onBoxBorder(sel, cx, cy)) cur = 'crosshair';
    }
    if (cur === 'default' && sel && sel.type === 'arrow' && endpointAt(px, py, sel)) cur = 'grab';
    const hit = shapeIdAt(cx, cy);
    if (cur === 'default' && hit) cur = 'move';
    if (hit !== app.hoverId) {
      app.hoverId = hit;
      render();
    }
  }
  canvas.style.cursor = cur;
}

export function initInteractions(): void {
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const { px, py } = eventPos(e);
    const { x: cx, y: cy } = cellAt(px, py);
    const hit = shapeIdAt(cx, cy);
    const s = hit != null ? getShape(hit) : null;
    if (s && s.type === 'arrow') {
      app.selection = new Set([s.id]);
      cycleArrowHeads();
    }
  });
  canvas.addEventListener('dblclick', onDblClick);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
}
