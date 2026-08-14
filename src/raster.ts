import { COLS, PRI, ROWS } from './constants';
import type { ArrowShape, BoxShape, Point, Put, Raster, Shape, TextShape } from './types';
import { clamp } from './util';

/* ============================================================
 * Rasterizer — shapes → character grid.
 * The same grid paints the canvas, feeds hit-testing, and is
 * sliced for the ASCII export.
 * ============================================================ */

export function rasterize(shapes: Shape[], cols = COLS, rows = ROWS): Raster {
  const N = cols * rows;
  const ch: string[] = new Array(N).fill(' ');
  const id = new Int32Array(N);
  const pri = new Uint8Array(N);

  const put: Put = (x, y, c, sid, p) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    if (p === PRI.line && pri[i] === PRI.line) {
      // line-over-line: keep/create junctions
      if (ch[i] === '+') { id[i] = sid; return; }
      if ((c === '-' && ch[i] === '|') || (c === '|' && ch[i] === '-')) {
        ch[i] = '+'; id[i] = sid; return;
      }
    }
    if (p >= pri[i]) { ch[i] = c; id[i] = sid; pri[i] = p; }
  };

  for (const s of shapes) {
    if (s.type === 'box') drawBox(s, put);
    else if (s.type === 'arrow') drawArrow(s, shapes, put);
    else drawText(s, put);
  }
  return { ch, id, pri, cols, rows };
}

function drawBox(s: BoxShape, put: Put): void {
  const { x, y, w, h, id } = s;
  for (let j = 1; j < h - 1; j++)
    for (let i = 1; i < w - 1; i++) put(x + i, y + j, ' ', id, PRI.boxfill);
  for (let i = 0; i < w; i++) {
    put(x + i, y, '-', id, PRI.boxborder);
    put(x + i, y + h - 1, '-', id, PRI.boxborder);
  }
  for (let j = 0; j < h; j++) {
    put(x, y + j, '|', id, PRI.boxborder);
    put(x + w - 1, y + j, '|', id, PRI.boxborder);
  }
  put(x, y, '+', id, PRI.boxborder);
  put(x + w - 1, y, '+', id, PRI.boxborder);
  put(x, y + h - 1, '+', id, PRI.boxborder);
  put(x + w - 1, y + h - 1, '+', id, PRI.boxborder);

  const iw = w - 2, ih = h - 2;
  if (s.text && iw > 0 && ih > 0) {
    const lines = s.text.split('\n').slice(0, ih);
    const y0 = y + 1 + ((ih - lines.length) >> 1);
    lines.forEach((line, li) => {
      const t = line.slice(0, iw);
      const x0 = x + 1 + ((iw - t.length) >> 1);
      for (let k = 0; k < t.length; k++) put(x0 + k, y0 + li, t[k], id, PRI.text);
    });
  }
}

function drawText(s: TextShape, put: Put): void {
  (s.text || '').split('\n').forEach((line, li) => {
    for (let k = 0; k < line.length; k++)
      put(s.x + k, s.y + li, line[k], s.id, PRI.text);
  });
}

function drawArrow(s: ArrowShape, shapes: Shape[], put: Put): void {
  const pts = resolveArrow(s, shapes);
  if (pts.length < 2) {
    put(pts[0].x, pts[0].y, '>', s.id, PRI.head);
    return;
  }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (let x = lo; x <= hi; x++) put(x, a.y, '-', s.id, PRI.line);
    } else {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (let y = lo; y <= hi; y++) put(a.x, y, '|', s.id, PRI.line);
    }
  }
  for (let i = 1; i < pts.length - 1; i++)
    put(pts[i].x, pts[i].y, '+', s.id, PRI.line);

  const heads = s.heads ?? 'end';
  if (heads !== 'start') {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const head = b.x > a.x ? '>' : b.x < a.x ? '<' : b.y > a.y ? 'v' : '^';
    put(b.x, b.y, head, s.id, PRI.head);
  }
  if (heads !== 'end') {
    const a0 = pts[1], b0 = pts[0];
    const tail = b0.x > a0.x ? '>' : b0.x < a0.x ? '<' : b0.y > a0.y ? 'v' : '^';
    put(b0.x, b0.y, tail, s.id, PRI.head);
  }

  if (s.text) {
    const mid = pathMidpoint(pts);
    s.text.split('\n').forEach((line, li) => {
      const x0 = mid.x - (line.length >> 1);
      const y0 = mid.y + li;
      put(x0 - 1, y0, ' ', s.id, PRI.text);
      for (let k = 0; k < line.length; k++) put(x0 + k, y0, line[k], s.id, PRI.text);
      put(x0 + line.length, y0, ' ', s.id, PRI.text);
    });
  }
}

/* ============================================================
 * Unicode restyling — display/export-time translation of the
 * ASCII grid to box-drawing characters. Junction shape ('┌' vs
 * '┼' …) is derived from which neighbors connect.
 * ============================================================ */

const UNI_HEAD: Record<string, string> = { '>': '▶', '<': '◀', 'v': '▼', '^': '▲' };
// Bitmask: L=1, R=2, U=4, D=8.
const UNI_JUNCTION: Record<number, string> = {
  3: '─', 12: '│', 10: '┌', 9: '┐', 6: '└', 5: '┘',
  11: '┬', 7: '┴', 14: '├', 13: '┤', 15: '┼',
};

export function stylize(r: Raster): string[] {
  const isLinePri = (p: number) => p === PRI.line || p === PRI.boxborder;
  const connects = (x: number, y: number, axis: 'h' | 'v'): boolean => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return false;
    const i = y * r.cols + x;
    if (isLinePri(r.pri[i])) {
      const c = r.ch[i];
      return c === '+' || c === (axis === 'h' ? '-' : '|');
    }
    return false;
  };
  const out = new Array<string>(r.cols * r.rows);
  for (let y = 0; y < r.rows; y++)
    for (let x = 0; x < r.cols; x++) {
      const i = y * r.cols + x;
      const c = r.ch[i];
      if (r.pri[i] === PRI.head) {
        out[i] = UNI_HEAD[c] ?? c;
      } else if (isLinePri(r.pri[i])) {
        if (c === '-') out[i] = '─';
        else if (c === '|') out[i] = '│';
        else if (c === '+') {
          const mask =
            (connects(x - 1, y, 'h') ? 1 : 0) |
            (connects(x + 1, y, 'h') ? 2 : 0) |
            (connects(x, y - 1, 'v') ? 4 : 0) |
            (connects(x, y + 1, 'v') ? 8 : 0);
          out[i] = UNI_JUNCTION[mask] ?? '┼';
        } else out[i] = c;
      } else out[i] = c;
    }
  return out;
}

/** Cell at half the walked length of an orthogonal path. */
export function pathMidpoint(pts: Point[]): Point {
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++)
    total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  let want = total >> 1;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (want <= len) {
      return { x: a.x + Math.sign(b.x - a.x) * want, y: a.y + Math.sign(b.y - a.y) * want };
    }
    want -= len;
  }
  return pts[0];
}

/**
 * Pick the border side of `b` facing `o`; returns the cell just OUTSIDE it.
 * `off` shifts the anchor along the side (parallel-arrow spreading).
 */
function anchor(b: BoxShape, o: Point, off = 0): { x: number; y: number; axis: 'h' | 'v' } {
  const cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2;
  const dx = (o.x - cx) / Math.max(1, b.w / 2);
  const dy = (o.y - cy) / Math.max(1, b.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? b.x + b.w : b.x - 1, y: clamp(o.y + off, b.y + 1, b.y + b.h - 2), axis: 'h' };
  }
  return { x: clamp(o.x + off, b.x + 1, b.x + b.w - 2), y: dy >= 0 ? b.y + b.h : b.y - 1, axis: 'v' };
}

/**
 * Orthogonal route between two (possibly box-attached) endpoints.
 * Writes resolved anchors back into the arrow so a later detach
 * (e.g. deleting the box) keeps the endpoint where it last was.
 */
export function resolveArrow(a: ArrowShape, shapes: Shape[]): Point[] {
  const boxOf = (id: number | null): BoxShape | null => {
    if (id == null) return null;
    const s = shapes.find((sh) => sh.id === id);
    return s && s.type === 'box' ? s : null;
  };
  const b1 = boxOf(a.box1), b2 = boxOf(a.box2);

  // Arrows sharing the same attached pair get spread along the border
  // (and distinct mid-lines) instead of overlapping.
  let off = 0;
  if (b1 && b2) {
    const siblings = shapes.filter((s): s is ArrowShape =>
      s.type === 'arrow' &&
      ((s.box1 === a.box1 && s.box2 === a.box2) || (s.box1 === a.box2 && s.box2 === a.box1)));
    if (siblings.length > 1) {
      const i = siblings.findIndex((s) => s.id === a.id);
      off = (i - (siblings.length - 1) / 2) * 2;
    }
  }

  let p1: Point = { x: a.x1, y: a.y1 }, p2: Point = { x: a.x2, y: a.y2 };
  let ax1: 'h' | 'v' | null = null, ax2: 'h' | 'v' | null = null;
  const o1 = b2 ? { x: b2.x + (b2.w >> 1), y: b2.y + (b2.h >> 1) } : p2;
  const o2 = b1 ? { x: b1.x + (b1.w >> 1), y: b1.y + (b1.h >> 1) } : p1;
  if (b1) { const an = anchor(b1, o1, off); p1 = { x: an.x, y: an.y }; ax1 = an.axis; a.x1 = an.x; a.y1 = an.y; }
  if (b2) { const an = anchor(b2, o2, off); p2 = { x: an.x, y: an.y }; ax2 = an.axis; a.x2 = an.x; a.y2 = an.y; }

  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (!ax1 && !ax2) {
    if (dy === 0) ax1 = ax2 = 'h';
    else if (dx === 0) ax1 = ax2 = 'v';
    else if (Math.abs(dx) >= Math.abs(dy)) { ax1 = 'h'; ax2 = 'v'; }
    else { ax1 = 'v'; ax2 = 'h'; }
  } else if (ax1 && !ax2) {
    ax2 = ax1 === 'h' ? (dy === 0 ? 'h' : 'v') : (dx === 0 ? 'v' : 'h');
  } else if (!ax1 && ax2) {
    ax1 = ax2 === 'h' ? (dy === 0 ? 'h' : 'v') : (dx === 0 ? 'v' : 'h');
  }

  let pts: Point[];
  if (ax1 === 'h' && ax2 === 'h') {
    if (dy === 0) pts = [p1, p2];
    else {
      const mx = ((p1.x + p2.x) >> 1) + off;
      pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
  } else if (ax1 === 'v' && ax2 === 'v') {
    if (dx === 0) pts = [p1, p2];
    else {
      const my = ((p1.y + p2.y) >> 1) + off;
      pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
  } else if (ax1 === 'h') {
    pts = [p1, { x: p2.x, y: p1.y }, p2];
  } else {
    pts = [p1, { x: p1.x, y: p2.y }, p2];
  }

  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    if (pts[i].x !== last.x || pts[i].y !== last.y) out.push(pts[i]);
  }
  return out;
}
