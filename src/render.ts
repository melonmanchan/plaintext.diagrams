import { CH, COLOR, COLS, CW, FONT, ROWS } from './constants';
import { rasterize } from './raster';
import { boxHandles } from './shapes';
import { app, getShape, soleSel } from './store';
import type { Shape } from './types';

/* ============================================================
 * Canvas painting + toolbar sync. Reads app state, never mutates
 * it (except caching the raster for hit-testing).
 * ============================================================ */

export const W = COLS * CW, H = ROWS * CH;

const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
export const ctx = canvas.getContext('2d')!;
let dotPattern: CanvasPattern | null = null;

export function setupCanvas(): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const world = document.querySelector<HTMLElement>('#world')!;
  world.style.width = W + 'px';
  world.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

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
  return s.type === 'arrow' ? COLOR.arrow : s.type === 'text' ? COLOR.text : COLOR.box;
}

export function render(): void {
  const grid = rasterize(app.doc.shapes);
  app.grid = grid;

  ctx.fillStyle = dotPattern ?? COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  // selection / hover backgrounds
  if (app.selection.size || app.hoverId != null) {
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const sid = grid.id[y * COLS + x];
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
  const colorCache = new Map<number, string>();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      const c = grid.ch[i];
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
  }
  updateToolbar();
}

function drawHandles(): void {
  const s = soleSel();
  if (!s || app.editing != null) return;
  ctx.fillStyle = COLOR.sel;
  ctx.strokeStyle = COLOR.bg;
  if (s.type === 'box') {
    for (const h of boxHandles(s)) {
      ctx.fillRect(h.px - 4, h.py - 4, 8, 8);
      ctx.strokeRect(h.px - 4, h.py - 4, 8, 8);
    }
  } else if (s.type === 'arrow') {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]] as const) {
      ctx.beginPath();
      ctx.arc(x * CW + CW / 2, y * CH + CH / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

export function updateToolbar(): void {
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === app.tool));
  document.querySelector<HTMLButtonElement>('#undo')!.disabled = !app.undoStack.length;
  document.querySelector<HTMLButtonElement>('#redo')!.disabled = !app.redoStack.length;
  document.querySelector<HTMLButtonElement>('#delete')!.disabled = !app.selection.size;
}
