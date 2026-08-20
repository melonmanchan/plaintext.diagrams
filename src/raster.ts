import { COLS, PRI, ROWS } from './constants';
import type { ArrowShape, BoxShape, GroupShape, Point, Put, Raster, Shape, Side, TextShape } from './types';
import { clamp } from './util';
import { laneBounds } from './shapes';

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
      // dashed vertical over solid horizontal (or vice versa) also junctions
      if ((c === ':' && ch[i] === '-') || (c === '-' && ch[i] === ':')) {
        ch[i] = '+'; id[i] = sid; return;
      }
    }
    if (p >= pri[i]) { ch[i] = c; id[i] = sid; pri[i] = p; }
  };

  /** Hit-test-only marker for cells a dashed line skips visually. */
  const ghost = (x: number, y: number, sid: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    if (id[i] === 0) id[i] = sid;
  };
  /** Is the cell already occupied by lower layers (border, line …)? */
  const busy = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < cols && y < rows && pri[y * cols + x] > 0;

  // Groups first so their frames sit beneath everything else.
  for (const s of shapes) if (s.type === 'group') drawGroup(s, put);
  for (const s of shapes) {
    if (s.type === 'box') drawBox(s, put);
    else if (s.type === 'arrow') drawArrow(s, shapes, put, ghost, busy);
    else if (s.type === 'text') drawText(s, put);
  }
  return { ch, id, pri, cols, rows };
}

function drawGroup(s: GroupShape, put: Put): void {
  const { x, y, w, h, id } = s;
  const title = (s.text ?? '').split('\n')[0];
  const tabbed = !!title && h >= 5;
  const top = tabbed ? y + 2 : y; // main frame's top border row

  if (tabbed) {
    const tw = Math.min(w, title.length + 4);
    for (let i = 0; i < tw; i++) put(x + i, y, '=', id, PRI.groupborder);
    put(x, y, '+', id, PRI.groupborder);
    put(x + tw - 1, y, '+', id, PRI.groupborder);
    put(x, y + 1, '|', id, PRI.groupborder);
    put(x + tw - 1, y + 1, '|', id, PRI.groupborder);
    const t = title.slice(0, Math.max(0, tw - 4));
    for (let k = 0; k < t.length; k++) put(x + 2 + k, y + 1, t[k], id, PRI.text);
  }

  for (let i = 0; i < w; i++) {
    put(x + i, top, '=', id, PRI.groupborder);
    put(x + i, y + h - 1, '=', id, PRI.groupborder);
  }
  for (let j = top; j < y + h; j++) {
    put(x, j, '|', id, PRI.groupborder);
    put(x + w - 1, j, '|', id, PRI.groupborder);
  }
  put(x, top, '+', id, PRI.groupborder);
  put(x + w - 1, top, '+', id, PRI.groupborder);
  put(x, y + h - 1, '+', id, PRI.groupborder);
  put(x + w - 1, y + h - 1, '+', id, PRI.groupborder);
  if (tabbed) {
    // junction where the tab's right side meets the frame's top border
    put(x + Math.min(w, title.length + 4) - 1, top, '+', id, PRI.groupborder);
  }
  if (!tabbed && s.text && h > 2) {
    // frame too short for a tab: fall back to inline title
    const t = title.slice(0, Math.max(0, w - 4));
    for (let k = 0; k < t.length; k++) put(x + 2 + k, y + 1, t[k], id, PRI.text);
  }

  // Vertical swimlanes: header band + underline + full-height separators.
  const n = s.lanes?.length ?? 0;
  if (n >= 2 && y + h - 1 - top >= 4) {
    const bounds = laneBounds(s);
    const u = top + 2; // header underline row
    for (let i = 1; i < w - 1; i++) put(x + i, u, '=', id, PRI.groupborder);
    put(x, u, '+', id, PRI.groupborder);
    put(x + w - 1, u, '+', id, PRI.groupborder);
    for (const bx of bounds) {
      for (let j = top + 1; j < y + h - 1; j++) put(bx, j, '|', id, PRI.groupborder);
      put(bx, top, '+', id, PRI.groupborder);
      put(bx, u, '+', id, PRI.groupborder);
      put(bx, y + h - 1, '+', id, PRI.groupborder);
    }
    const edges = [x, ...bounds, x + w - 1];
    for (let li = 0; li < n; li++) {
      const lo = edges[li] + 2, hi = edges[li + 1] - 1;
      const t = (s.lanes![li] ?? '').slice(0, Math.max(0, hi - lo));
      for (let k = 0; k < t.length; k++) put(lo + k, top + 1, t[k], id, PRI.text);
    }
  }
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
  const [tl, tr, bl, br] = s.style === 'round' ? ['.', '.', "'", "'"] : ['+', '+', '+', '+'];
  put(x, y, tl, id, PRI.boxborder);
  put(x + w - 1, y, tr, id, PRI.boxborder);
  put(x, y + h - 1, bl, id, PRI.boxborder);
  put(x + w - 1, y + h - 1, br, id, PRI.boxborder);

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

/** Head glyph pointing INTO a box anchored on the given side. */
const INTO_HEAD: Record<Side, string> = { left: '>', right: '<', top: 'v', bottom: '^' };

function drawArrow(
  s: ArrowShape, shapes: Shape[], put: Put,
  ghost: (x: number, y: number, sid: number) => void,
  busy: (x: number, y: number) => boolean,
): void {
  const { pts, into1, into2 } = resolveArrow(s, shapes);
  if (pts.length < 2) {
    put(pts[0].x, pts[0].y, '>', s.id, PRI.head);
    return;
  }
  // Dashed arrows: horizontal runs drop every other cell visually; skipped
  // cells still get a hit-test ghost id so the arrow stays clickable along
  // its whole run. Cells over existing content (borders, lines) are always
  // drawn so crossings stay continuous and parseable; so are cells near
  // bends. Vertical runs use a dotted glyph (':' → '┊') on every cell
  // instead — row-gapping reads solid at 2:1 cell aspect.
  const dashed = s.style === 'dashed';
  const putL = (x: number, y: number, c: string, force: boolean) => {
    if (!dashed || force || (x + y) % 2 === 0 || busy(x, y)) put(x, y, c, s.id, PRI.line);
    else ghost(x, y, s.id);
  };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (let x = lo; x <= hi; x++) putL(x, a.y, '-', x <= lo + 1 || x >= hi - 1);
    } else {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (let y = lo; y <= hi; y++)
        put(a.x, y, dashed ? ':' : '|', s.id, PRI.line);
    }
  }
  for (let i = 1; i < pts.length - 1; i++)
    put(pts[i].x, pts[i].y, '+', s.id, PRI.line);

  const heads = s.heads ?? 'end';
  if (heads !== 'start') {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const head = into2 ?? (b.x > a.x ? '>' : b.x < a.x ? '<' : b.y > a.y ? 'v' : '^');
    put(b.x, b.y, head, s.id, PRI.head);
  }
  if (heads !== 'end') {
    const a0 = pts[1], b0 = pts[0];
    const tail = into1 ?? (b0.x > a0.x ? '>' : b0.x < a0.x ? '<' : b0.y > a0.y ? 'v' : '^');
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
// Double-line variants for group frames.
const UNI_GROUP: Record<number, string> = {
  3: '═', 12: '║', 10: '╔', 9: '╗', 6: '╚', 5: '╝',
  11: '╦', 7: '╩', 14: '╠', 13: '╣', 15: '╬',
};

export function stylize(r: Raster): string[] {
  const isLinePri = (p: number) => p === PRI.line || p === PRI.boxborder;
  const connects = (x: number, y: number, axis: 'h' | 'v'): boolean => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return false;
    const i = y * r.cols + x;
    if (r.pri[i] === PRI.head) {
      // an arrowhead continues the line along its own axis
      const c = r.ch[i];
      return axis === 'h' ? c === '<' || c === '>' : c === 'v' || c === '^';
    }
    if (isLinePri(r.pri[i])) {
      const c = r.ch[i];
      return c === '+' || c === (axis === 'h' ? '-' : '|') || (axis === 'v' && c === ':');
    }
    return false;
  };
  const connectsG = (x: number, y: number, axis: 'h' | 'v'): boolean => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows) return false;
    const i = y * r.cols + x;
    if (r.pri[i] !== PRI.groupborder) return false;
    const c = r.ch[i];
    return c === '+' || c === (axis === 'h' ? '=' : '|');
  };
  const out = new Array<string>(r.cols * r.rows);
  for (let y = 0; y < r.rows; y++)
    for (let x = 0; x < r.cols; x++) {
      const i = y * r.cols + x;
      const c = r.ch[i];
      if (r.pri[i] === PRI.head) {
        out[i] = UNI_HEAD[c] ?? c;
      } else if (r.pri[i] === PRI.groupborder) {
        if (c === '=') out[i] = '═';
        else if (c === '|') out[i] = '║';
        else if (c === '+') {
          const mask =
            (connectsG(x - 1, y, 'h') ? 1 : 0) |
            (connectsG(x + 1, y, 'h') ? 2 : 0) |
            (connectsG(x, y - 1, 'v') ? 4 : 0) |
            (connectsG(x, y + 1, 'v') ? 8 : 0);
          out[i] = UNI_GROUP[mask] ?? '╬';
        } else out[i] = c;
      } else if (isLinePri(r.pri[i])) {
        if (c === '-') out[i] = '─';
        else if (c === '|') out[i] = '│';
        else if (c === ':') out[i] = '┊';
        else if (c === '+') {
          const mask =
            (connects(x - 1, y, 'h') ? 1 : 0) |
            (connects(x + 1, y, 'h') ? 2 : 0) |
            (connects(x, y - 1, 'v') ? 4 : 0) |
            (connects(x, y + 1, 'v') ? 8 : 0);
          out[i] = UNI_JUNCTION[mask] ?? '┼';
        } else if (c === '.') {
          out[i] = connects(x - 1, y, 'h') ? '╮' : '╭';
        } else if (c === "'") {
          out[i] = connects(x - 1, y, 'h') ? '╯' : '╰';
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



/** Cell just OUTSIDE a given border side, at `cross` along it (clamped). */
function anchorOn(b: BoxShape, side: Side, cross: number): { x: number; y: number; axis: 'h' | 'v' } {
  if (side === 'right') return { x: b.x + b.w, y: clamp(cross, b.y + 1, b.y + b.h - 2), axis: 'h' };
  if (side === 'left') return { x: b.x - 1, y: clamp(cross, b.y + 1, b.y + b.h - 2), axis: 'h' };
  if (side === 'bottom') return { x: clamp(cross, b.x + 1, b.x + b.w - 2), y: b.y + b.h, axis: 'v' };
  return { x: clamp(cross, b.x + 1, b.x + b.w - 2), y: b.y - 1, axis: 'v' };
}

/**
 * Anchor for slot `slot` of a group of parallel arrows aimed at `o`,
 * placed `off` cells from the natural anchor along the facing side.
 * Once that side is full, remaining arrows wrap onto the two
 * perpendicular sides.
 */
export function sideFor(b: BoxShape, o: Point): Side {
  const cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2;
  const ndx = (o.x - cx) / Math.max(1, b.w / 2);
  const ndy = (o.y - cy) / Math.max(1, b.h / 2);
  return Math.abs(ndx) >= Math.abs(ndy)
    ? (ndx >= 0 ? 'right' : 'left')
    : (ndy >= 0 ? 'bottom' : 'top');
}

function anchorFor(b: BoxShape, o: Point, side: Side, slot: number, off: number): { x: number; y: number; axis: 'h' | 'v'; side: Side } {
  const vertical = side === 'left' || side === 'right';
  const span = vertical ? b.h - 2 : b.w - 2;
  const cap = Math.max(1, (span + 1) >> 1);

  if (slot < cap) {
    return { ...anchorOn(b, side, Math.round((vertical ? o.y : o.x) + off)), side };
  }
  // Overflow: alternate between the two perpendicular sides, hugging
  // the corner that faces the target and stepping inward.
  const ovf = slot - cap;
  const inset = (Math.floor(ovf / 2) + 1) * 2;
  if (vertical) {
    const oside: Side = ovf % 2 ? 'bottom' : 'top';
    const cross = side === 'right' ? b.x + b.w - 1 - inset : b.x + inset;
    return { ...anchorOn(b, oside, cross), side: oside };
  }
  const oside: Side = ovf % 2 ? 'right' : 'left';
  const cross = side === 'bottom' ? b.y + b.h - 1 - inset : b.y + inset;
  return { ...anchorOn(b, oside, cross), side: oside };
}

/** Resolved arrow: orthogonal path plus into-box head overrides. */
export interface ResolvedArrow {
  pts: Point[];
  into1: string | null;
  into2: string | null;
}

/**
 * Orthogonal route between two (possibly box-attached) endpoints.
 * Writes resolved anchors back into the arrow so a later detach
 * (e.g. deleting the box) keeps the endpoint where it last was.
 */
export function resolveArrow(a: ArrowShape, shapes: Shape[]): ResolvedArrow {
  const boxOf = (id: number | null): BoxShape | null => {
    if (id == null) return null;
    const s = shapes.find((sh) => sh.id === id);
    return s && s.type === 'box' ? s : null;
  };
  const b1 = boxOf(a.box1), b2 = boxOf(a.box2);

  // Arrow endpoints whose natural anchor lands on the same cell of the same
  // box side get spread across slots — regardless of where their other end
  // goes — so distinct arrows never overlap into a shared rail (which
  // parses ambiguously). Endpoints that naturally separate keep their spot.
  const center = (b: BoxShape): Point => ({ x: b.x + (b.w >> 1), y: b.y + (b.h >> 1) });
  const slotOn = (b: BoxShape, side: Side, o: Point, which: 1 | 2): { slot: number; off: number } => {
    const vertical = side === 'left' || side === 'right';
    const cellOf = (t: Point): number => vertical
      ? clamp(Math.round(t.y), b.y + 1, b.y + b.h - 2)
      : clamp(Math.round(t.x), b.x + 1, b.x + b.w - 2);
    const cell = cellOf(o);
    // A sibling's collision cell is its exact pin when it has one.
    const pinnedCell = (at: number | undefined, t: Point): number =>
      cellOf(at != null ? (vertical ? { x: t.x, y: b.y + at } : { x: b.x + at, y: t.y }) : t);
    const entries: { id: number; which: 1 | 2 }[] = [];
    for (const s of shapes) {
      if (s.type !== 'arrow') continue;
      const sb1 = boxOf(s.box1), sb2 = boxOf(s.box2);
      if (sb1 === b) {
        const t = sb2 ? center(sb2) : { x: s.x2, y: s.y2 };
        if ((s.side1 ?? sideFor(b, t)) === side && pinnedCell(s.side1 != null ? s.at1 : undefined, t) === cell)
          entries.push({ id: s.id, which: 1 });
      }
      if (sb2 === b) {
        const t = sb1 ? center(sb1) : { x: s.x1, y: s.y1 };
        if ((s.side2 ?? sideFor(b, t)) === side && pinnedCell(s.side2 != null ? s.at2 : undefined, t) === cell)
          entries.push({ id: s.id, which: 2 });
      }
    }
    if (entries.length <= 1) return { slot: 0, off: 0 };
    const slot = Math.max(0, entries.findIndex((e) => e.id === a.id && e.which === which));
    // Center-out: slot 0 stays on the natural line, later slots
    // alternate outward (-2, +2, -4, +4 …) matching overflow wrap.
    return { slot, off: (slot % 2 ? -1 : 1) * Math.ceil(slot / 2) * 2 };
  };

  let p1: Point = { x: a.x1, y: a.y1 }, p2: Point = { x: a.x2, y: a.y2 };
  let ax1: 'h' | 'v' | null = null, ax2: 'h' | 'v' | null = null;
  let side1: Side | null = null, side2: Side | null = null;
  let off1 = 0, off2 = 0;
  const o1 = b2 ? { x: b2.x + (b2.w >> 1), y: b2.y + (b2.h >> 1) } : p2;
  const o2 = b1 ? { x: b1.x + (b1.w >> 1), y: b1.y + (b1.h >> 1) } : p1;
  /** Exact pins replace the target-facing cross with the stored offset. */
  const pinTarget = (b: BoxShape, side: Side, at: number | undefined, o: Point): Point => {
    if (at == null) return o;
    return side === 'left' || side === 'right'
      ? { x: o.x, y: b.y + at }
      : { x: b.x + at, y: o.y };
  };
  if (b1) {
    const side = a.side1 ?? sideFor(b1, o1);
    const t = pinTarget(b1, side, a.side1 != null ? a.at1 : undefined, o1);
    const { slot, off } = slotOn(b1, side, t, 1);
    off1 = off;
    const an = anchorFor(b1, t, side, slot, off);
    p1 = { x: an.x, y: an.y }; ax1 = an.axis; side1 = an.side; a.x1 = an.x; a.y1 = an.y;
  }
  if (b2) {
    const side = a.side2 ?? sideFor(b2, o2);
    const t = pinTarget(b2, side, a.side2 != null ? a.at2 : undefined, o2);
    const { slot, off } = slotOn(b2, side, t, 2);
    off2 = off;
    const an = anchorFor(b2, t, side, slot, off);
    p2 = { x: an.x, y: an.y }; ax2 = an.axis; side2 = an.side; a.x2 = an.x; a.y2 = an.y;
  }
  // Mid-line spread offset: parallel Z-routes keep distinct mid-lines.
  const off = off1 !== 0 ? off1 : off2;

  // A 1-cell jog between opposite side anchors reads badly in ASCII:
  // nudge one anchor into line when the border span allows it.
  if (ax1 === 'h' && ax2 === 'h' && side1 !== side2 && Math.abs(p2.y - p1.y) === 1) {
    if (b2 && p1.y > b2.y && p1.y < b2.y + b2.h - 1) { p2 = { x: p2.x, y: p1.y }; a.y2 = p1.y; }
    else if (b1 && p2.y > b1.y && p2.y < b1.y + b1.h - 1) { p1 = { x: p1.x, y: p2.y }; a.y1 = p2.y; }
  } else if (ax1 === 'v' && ax2 === 'v' && side1 !== side2 && Math.abs(p2.x - p1.x) === 1) {
    if (b2 && p1.x > b2.x && p1.x < b2.x + b2.w - 1) { p2 = { x: p1.x, y: p2.y }; a.x2 = p1.x; }
    else if (b1 && p2.x > b1.x && p2.x < b1.x + b1.w - 1) { p1 = { x: p2.x, y: p1.y }; a.x1 = p2.x; }
  }

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

  // ---- shared route-avoidance machinery ------------------------------
  // Cleanliness: no segment overlaps ANY box. The segments adjacent to an
  // attached anchor are exempt for their own box (they must touch it), and
  // outward stubs are safe by construction.
  const obstacles = shapes.filter(
    (s): s is BoxShape => s.type === 'box' && s !== b1 && s !== b2,
  );
  const hitsBox = (u: Point, v: Point, b: BoxShape | null): boolean => {
    if (!b) return false;
    return Math.max(u.x, v.x) >= b.x && Math.min(u.x, v.x) <= b.x + b.w - 1 &&
           Math.max(u.y, v.y) >= b.y && Math.min(u.y, v.y) <= b.y + b.h - 1;
  };
  const segsClean = (pts: Point[]): boolean => {
    for (let i = 0; i < pts.length - 1; i++) {
      const u = pts[i], v = pts[i + 1];
      if (i > 0 && hitsBox(u, v, b1)) return false;
      if (i < pts.length - 2 && hitsBox(u, v, b2)) return false;
      for (const ob of obstacles) if (hitsBox(u, v, ob)) return false;
    }
    return true;
  };
  const pathLen = (pts: Point[]): number => {
    let t = 0;
    for (let i = 0; i < pts.length - 1; i++)
      t += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    return t;
  };
  /** Escape-stub routing: shortest candidate whose segments cross no box. */
  const routeAvoiding = (): Point[] => {
    const outPt = (p: Point, side: Side | null, k: number): Point =>
      side === 'right' ? { x: p.x + k, y: p.y }
      : side === 'left' ? { x: p.x - k, y: p.y }
      : side === 'bottom' ? { x: p.x, y: p.y + k }
      : side === 'top' ? { x: p.x, y: p.y - k }
      : p;
    const e1 = outPt(p1, side1, 2 + Math.abs(off1));
    const e2 = outPt(p2, side2, 2 + Math.abs(off2));
    const candidates: Point[][] = [
      [p1, e1, { x: e2.x, y: e1.y }, e2, p2],
      [p1, e1, { x: e1.x, y: e2.y }, e2, p2],
    ];
    // Corridors around the union of the endpoint boxes and any obstacle
    // near the direct span, for when both simple bends collide.
    const spanX1 = Math.min(p1.x, p2.x) - 4, spanX2 = Math.max(p1.x, p2.x) + 4;
    const spanY1 = Math.min(p1.y, p2.y) - 4, spanY2 = Math.max(p1.y, p2.y) + 4;
    const bs = [b1, b2, ...obstacles.filter((o) =>
      o.x <= spanX2 && o.x + o.w - 1 >= spanX1 && o.y <= spanY2 && o.y + o.h - 1 >= spanY1,
    )].filter((b): b is BoxShape => b != null);
    if (bs.length) {
      const minX = Math.min(...bs.map((b) => b.x)) - 2;
      const maxX = Math.max(...bs.map((b) => b.x + b.w - 1)) + 2;
      const minY = Math.min(...bs.map((b) => b.y)) - 2;
      const maxY = Math.max(...bs.map((b) => b.y + b.h - 1)) + 2;
      for (const cx of [minX, maxX])
        candidates.push([p1, e1, { x: cx, y: e1.y }, { x: cx, y: e2.y }, e2, p2]);
      for (const cy of [minY, maxY])
        candidates.push([p1, e1, { x: e1.x, y: cy }, { x: e2.x, y: cy }, e2, p2]);
    }
    const usable = candidates.filter(segsClean);
    return (usable.length ? usable : candidates)
      .reduce((best, c) => (pathLen(c) < pathLen(best) ? c : best));
  };
  const finalize = (route: Point[]): ResolvedArrow => {
    const out: Point[] = [route[0]];
    for (let i = 1; i < route.length; i++) {
      const last = out[out.length - 1];
      if (route[i].x !== last.x || route[i].y !== last.y) out.push(route[i]);
    }
    // drop collinear middle points so straight runs stay single segments
    for (let i = out.length - 2; i > 0; i--) {
      const a0 = out[i - 1], m = out[i], b0 = out[i + 1];
      if ((a0.x === m.x && m.x === b0.x) || (a0.y === m.y && m.y === b0.y)) out.splice(i, 1);
    }
    return {
      pts: out,
      into1: side1 ? INTO_HEAD[side1] : null,
      into2: side2 ? INTO_HEAD[side2] : null,
    };
  };

  // Pinned sides can face AWAY from the other endpoint; the legacy branches
  // below assume facing anchors — pinned arrows always take the avoiding
  // stub router.
  if ((a.side1 != null && b1) || (a.side2 != null && b2)) return finalize(routeAvoiding());

  let pts: Point[];
  if (ax1 === 'h' && ax2 === 'h') {
    if (dy === 0 && !(side1 != null && side1 === side2)) pts = [p1, p2];
    else {
      // Same-side pairs (left/left, right/right) loop around outside.
      const mx = side1 === 'left' && side2 === 'left'
        ? Math.min(p1.x, p2.x) - 1 - (Math.abs(off) >> 1)
        : side1 === 'right' && side2 === 'right'
          ? Math.max(p1.x, p2.x) + 1 + (Math.abs(off) >> 1)
          : ((p1.x + p2.x) >> 1) + off;
      pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
  } else if (ax1 === 'v' && ax2 === 'v') {
    if (dx === 0 && !(side1 != null && side1 === side2)) pts = [p1, p2];
    else {
      const my = side1 === 'top' && side2 === 'top'
        ? Math.min(p1.y, p2.y) - 1 - (Math.abs(off) >> 1)
        : side1 === 'bottom' && side2 === 'bottom'
          ? Math.max(p1.y, p2.y) + 1 + (Math.abs(off) >> 1)
          : ((p1.y + p2.y) >> 1) + off;
      pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
  } else if (ax1 === 'h') {
    // Horizontal exit → vertical approach. If the direct bend would cut
    // through the target box, detour around it on the source side.
    const K = 1 + (Math.abs(off) >> 1);
    if (b2 && (side2 === 'top' || side2 === 'bottom') &&
        (side2 === 'top' ? p1.y > p2.y : p1.y < p2.y)) {
      const outY = side2 === 'top' ? p2.y - K : p2.y + K;
      const cx = p1.x < p2.x ? b2.x - 1 - K : b2.x + b2.w + K;
      pts = [p1, { x: cx, y: p1.y }, { x: cx, y: outY }, { x: p2.x, y: outY }, p2];
    } else {
      pts = [p1, { x: p2.x, y: p1.y }, p2];
    }
  } else {
    // Vertical exit → horizontal approach; detour when leaving through
    // the source box would be required.
    const K = 1 + (Math.abs(off) >> 1);
    if (b1 && (side1 === 'top' || side1 === 'bottom') &&
        (side1 === 'top' ? p2.y > p1.y : p2.y < p1.y)) {
      const outY = side1 === 'top' ? p1.y - K : p1.y + K;
      const mx = ((p1.x + p2.x) >> 1) + off;
      pts = [p1, { x: p1.x, y: outY }, { x: mx, y: outY }, { x: mx, y: p2.y }, p2];
    } else {
      pts = [p1, { x: p1.x, y: p2.y }, p2];
    }
  }

  // Legacy routes stay exactly as they are when clean; only routes that
  // overdraw a box (endpoint or bystander) take the avoiding router.
  if ((b1 || b2) && !segsClean(pts)) return finalize(routeAvoiding());

  const out: Point[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    if (pts[i].x !== last.x || pts[i].y !== last.y) out.push(pts[i]);
  }
  return {
    pts: out,
    into1: side1 ? INTO_HEAD[side1] : null,
    into2: side2 ? INTO_HEAD[side2] : null,
  };
}
