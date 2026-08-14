import { CH, COLOR, COLS, CW, FONT, GROW_MARGIN, MAX_COLS, MAX_ROWS, ROWS } from './constants';
import { rasterize, stylize } from './raster';
import { boxHandles, contentExtent } from './shapes';
import { app, getShape, soleSel } from './store';
import type { Shape } from './types';

/* ============================================================
 * Canvas painting + toolbar sync. Reads app state, never mutates
 * it (except caching the raster for hit-testing).
 * ============================================================ */

const worldPx = () => ({ W: app.world.cols * CW, H: app.world.rows * CH });

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
export const ctx = canvas.getContext('2d')!;
let dotPattern: CanvasPattern | null = null;

export function setupCanvas(): void {
  const { W, H } = worldPx();
  const z = app.zoom;
  const dpr = window.devicePixelRatio || 1;
  // Cap backing-store density (and total area) so huge worlds/zooms
  // never allocate an oversized bitmap.
  let scale = Math.min(dpr, 2.5 / z) * z;
  const MAX_AREA = 180e6; // px²
  if (W * scale * H * scale > MAX_AREA) scale = Math.sqrt(MAX_AREA / (W * H));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(H * scale);
  canvas.style.width = W * z + 'px';
  canvas.style.height = H * z + 'px';
  const world = document.querySelector<HTMLElement>('#world')!;
  world.style.width = W * z + 'px';
  world.style.height = H * z + 'px';
  // Drawing code stays in world (cell-px) coordinates.
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const pc = document.createElement('canvas');
  pc.width = CW;
  pc.height = CH;
  const p = pc.getContext('2d')!;
  p.fillStyle = COLOR.bg;
  p.fillRect(0, 0, CW, CH);
  p.fillStyle = COLOR.dot;
  p.fillRect(0, 0, 2, 2);
  dotPattern = ctx.createPattern(pc, 'repeat');
}

function shapeColor(s: Shape | null): string {
  if (!s) return COLOR.box;
  if (app.selection.has(s.id)) return COLOR.sel;
  if (s.type === 'arrow') return COLOR.arrow;
  if (s.type === 'text') return COLOR.text;
  if (s.type === 'group') return COLOR.group;
  return COLOR.box;
}

export function render(): void {
  syncWorldSize();
  const { W, H } = worldPx();
  const grid = rasterize(app.doc.shapes, app.world.cols, app.world.rows);
  app.grid = grid;

  ctx.fillStyle = dotPattern ?? COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  // faint tint behind group frames (canvas only, not exported)
  ctx.fillStyle = 'rgba(166,173,200,0.05)';
  for (const s of app.doc.shapes)
    if (s.type === 'group') ctx.fillRect(s.x * CW, s.y * CH, s.w * CW, s.h * CH);

  // selection / hover backgrounds
  if (app.selection.size || app.hoverId != null) {
    for (let y = 0; y < grid.rows; y++)
      for (let x = 0; x < grid.cols; x++) {
        const sid = grid.id[y * grid.cols + x];
        if (!sid) continue;
        if (app.selection.has(sid)) {
          ctx.fillStyle = COLOR.selBg;
          ctx.fillRect(x * CW, y * CH, CW, CH);
        } else if (sid === app.hoverId && app.tool === 'select') {
          ctx.fillStyle = COLOR.hoverBg;
          ctx.fillRect(x * CW, y * CH, CW, CH);
        }
      }
  }

  // characters
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const display = app.unicode ? stylize(grid) : grid.ch;
  const colorCache = new Map<number, string>();
  for (let y = 0; y < grid.rows; y++)
    for (let x = 0; x < grid.cols; x++) {
      const i = y * grid.cols + x;
      const c = display[i];
      if (c === ' ') continue;
      const sid = grid.id[i];
      let col = colorCache.get(sid);
      if (!col) {
        col = shapeColor(getShape(sid));
        colorCache.set(sid, col);
      }
      ctx.fillStyle = col;
      ctx.fillText(c, x * CW + CW / 2, y * CH + CH / 2 + 1);
    }

  drawHandles();

  const d = app.drag;
  if (d && d.mode === 'marquee') {
    const x = Math.min(d.sx, d.cx), y = Math.min(d.sy, d.cy);
    const w = Math.abs(d.cx - d.sx) + 1, h = Math.abs(d.cy - d.sy) + 1;
    ctx.strokeStyle = COLOR.sel;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x * CW + 0.5, y * CH + 0.5, w * CW - 1, h * CH - 1);
    ctx.setLineDash([]);
  } else if (d && d.mode === 'move' && app.guides.length) {
    ctx.strokeStyle = COLOR.text;
    ctx.setLineDash([6, 4]);
    for (const g of app.guides) {
      ctx.beginPath();
      if (g.axis === 'v') { ctx.moveTo(g.px + 0.5, 0); ctx.lineTo(g.px + 0.5, H); }
      else { ctx.moveTo(0, g.px + 0.5); ctx.lineTo(W, g.px + 0.5); }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  updateToolbar();
}

/** Grow the world to fit content (+margin); shrink back only when idle. */
function syncWorldSize(): void {
  const ext = contentExtent(app.doc.shapes);
  const wantC = Math.min(MAX_COLS, Math.max(COLS, ext.x + GROW_MARGIN));
  const wantR = Math.min(MAX_ROWS, Math.max(ROWS, ext.y + GROW_MARGIN));
  const idle = !app.drag && app.editing == null;
  let c = app.world.cols, r = app.world.rows;
  if (wantC > c || idle) c = wantC;
  if (wantR > r || idle) r = wantR;
  if (c !== app.world.cols || r !== app.world.rows) {
    app.world.cols = c;
    app.world.rows = r;
    setupCanvas();
  }
}

function drawHandles(): void {
  const s = soleSel();
  if (!s || app.editing != null) return;
  ctx.fillStyle = COLOR.sel;
  ctx.strokeStyle = COLOR.bg;
  if (s.type === 'box' || s.type === 'group') {
    for (const h of boxHandles(s)) {
      ctx.fillRect(h.px - 4, h.py - 4, 8, 8);
      ctx.strokeRect(h.px - 4, h.py - 4, 8, 8);
    }
  } else if (s.type === 'arrow') {
    // Hollow rings on FREE endpoints only — attached ends follow their
    // box automatically and need no handle cluttering the border.
    const ends: [number, number, boolean][] = [
      [s.x1, s.y1, s.box1 != null],
      [s.x2, s.y2, s.box2 != null],
    ];
    for (const [x, y, attached] of ends) {
      if (attached) continue;
      const cx = x * CW + CW / 2, cy = y * CH + CH / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = COLOR.bg;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.strokeStyle = COLOR.sel;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.lineWidth = 1;
  }
}

export function updateToolbar(): void {
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === app.tool));
  document.querySelector<HTMLButtonElement>('#undo')!.disabled = !app.undoStack.length;
  document.querySelector<HTMLButtonElement>('#redo')!.disabled = !app.redoStack.length;
  document.querySelector<HTMLButtonElement>('#delete')!.disabled = !app.selection.size;
}
