import type { ArrowShape, BoxShape, GroupShape, Shape, TextShape } from './types';

/* ============================================================
 * ASCII importer — the inverse of export.ts. Parses boxes,
 * arrows (with attachment + embedded labels), box labels, and
 * free text out of plain ASCII art. Pure; ids are local 1..n.
 * ============================================================ */

const HEAD_DIR: Record<string, [number, number]> = {
  '>': [1, 0],
  '<': [-1, 0],
  'v': [0, 1],
  '^': [0, -1],
};

/** Unicode box-drawing → ASCII normalization, so both styles parse. */
const UNI_TO_ASCII: Record<string, string> = {
  '─': '-', '│': '|',
  '┌': '+', '┐': '+', '└': '+', '┘': '+',
  '├': '+', '┤': '+', '┬': '+', '┴': '+', '┼': '+',
  '═': '=', '║': '|',
  '╔': '+', '╗': '+', '╚': '+', '╝': '+',
  '╠': '+', '╣': '+', '╦': '+', '╩': '+', '╬': '+',
  '▶': '>', '►': '>', '◀': '<', '◄': '<', '▼': 'v', '▲': '^',
};

export function parseAscii(text: string): Shape[] {
  const normalized = text.replace(/[─│┌┐└┘├┤┬┴┼▶►◀◄▼▲]/g, (c) => UNI_TO_ASCII[c]);
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, ''));
  const H = lines.length;
  const at = (x: number, y: number): string =>
    y >= 0 && y < H && x >= 0 && x < lines[y].length ? lines[y][x] : ' ';
  const consumed = new Set<number>(); // cell keys: y * 100000 + x
  const free = (x: number, y: number) => !consumed.has(y * 100000 + x);
  const take = (x: number, y: number) => consumed.add(y * 100000 + x);
  const isH = (c: string) => c === '-' || c === '+';
  const isV = (c: string) => c === '|' || c === '+';

  let seq = 1;
  const groups: GroupShape[] = [];
  const boxes: BoxShape[] = [];
  const arrows: ArrowShape[] = [];
  const texts: TextShape[] = [];

  /* ---------- rectangles: groups (+==+) then boxes (+--+) ---------- */

  function rectBottom(x1: number, x2: number, y1: number, horiz: (c: string) => boolean): number | null {
    if (x2 - x1 < 2) return null;
    for (let y2 = y1 + 1; isV(at(x1, y2)) && isV(at(x2, y2)); y2++) {
      if (at(x1, y2) !== '+' || at(x2, y2) !== '+' || y2 - y1 < 2) continue;
      let ok = true;
      for (let i = x1 + 1; i < x2 && ok; i++) ok = horiz(at(i, y2));
      if (!ok) continue; // junction row — keep scanning down
      for (let i = x1; i <= x2; i++) { take(i, y1); take(i, y2); }
      for (let j = y1; j <= y2; j++) { take(x1, j); take(x2, j); }
      return y2;
    }
    return null;
  }

  const isHG = (c: string) => c === '=' || c === '+';

  // A group is either a plain +==+ frame, or a tabbed one:
  //   +=======+
  //   | Title |
  //   +=======+==============+   ← frame top continues right of the tab
  function groupAt(x: number, y: number): GroupShape | null {
    for (let x2 = x + 1; isHG(at(x2, y)); x2++) {
      if (at(x2, y) !== '+' || !lines[y].slice(x + 1, x2).includes('=')) continue;
      for (let yb = y + 1; isV(at(x, yb)) && isV(at(x2, yb)); yb++) {
        if (at(x, yb) !== '+' || at(x2, yb) !== '+') continue;
        if (at(x2 + 1, yb) === '=') {
          // tab: the corner row continues right into the frame's top border
          if (yb - y !== 2) break;
          for (let xr = x2 + 1; isHG(at(xr, yb)); xr++) {
            if (at(xr, yb) !== '+') continue;
            const yBot = rectBottom(x, xr, yb, isHG);
            if (yBot == null) continue;
            for (let i = x; i <= x2; i++) take(i, y);
            take(x, y + 1);
            take(x2, y + 1);
            let title = '';
            for (let i = x + 2; i <= x2 - 2; i++) {
              title += free(i, y + 1) ? at(i, y + 1) : ' ';
              take(i, y + 1);
            }
            return { type: 'group', id: seq++, x, y, w: xr - x + 1, h: yBot - y + 1, text: title.trim() };
          }
          break;
        }
        if (yb - y < 2) continue;
        let ok = true;
        for (let i = x + 1; i < x2 && ok; i++) ok = isHG(at(i, yb));
        if (!ok) continue;
        for (let i = x; i <= x2; i++) { take(i, y); take(i, yb); }
        for (let j = y; j <= yb; j++) { take(x, j); take(x2, j); }
        return { type: 'group', id: seq++, x, y, w: x2 - x + 1, h: yb - y + 1, text: '' };
      }
    }
    return null;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < lines[y].length; x++) {
      if (at(x, y) !== '+' || !free(x, y)) continue;
      const g = groupAt(x, y);
      if (g) groups.push(g);
    }
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < lines[y].length; x++) {
      if (at(x, y) !== '+' || !free(x, y)) continue;
      for (let x2 = x + 1; isH(at(x2, y)); x2++) {
        if (at(x2, y) !== '+') continue;
        const y2 = rectBottom(x, x2, y, isH);
        if (y2 != null) {
          boxes.push({ type: 'box', id: seq++, x, y, w: x2 - x + 1, h: y2 - y + 1, text: '' });
          break;
        }
      }
    }
  }

  /* ---------- arrows: trace back from each head ---------- */

  function attachedBox(px: number, py: number): number | null {
    const b = boxes.find(
      (o) => px >= o.x - 1 && px < o.x + o.w + 1 && py >= o.y - 1 && py < o.y + o.h + 1,
    );
    return b ? b.id : null;
  }

  function traceArrow(hx: number, hy: number, head: [number, number]): ArrowShape | null {
    const lineOf = (v: [number, number]) => (v[1] === 0 ? '-' : '|');
    // The line usually continues straight behind the head, but heads that
    // point into a box may be approached perpendicular (e.g. "----^").
    const back: [number, number] = [-head[0], -head[1]];
    const probes: [number, number][] = [
      back,
      ...(head[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]) as [number, number][],
    ];
    let dir: [number, number] = back;
    for (const p of probes) {
      const c = at(hx + p[0], hy + p[1]);
      if (free(hx + p[0], hy + p[1]) && (c === lineOf(p) || c === '+')) { dir = p; break; }
    }
    const cells: [number, number][] = [[hx, hy]];
    const labelCells: [number, number][] = [];
    let label = '';
    let dual = false;
    let cx = hx + dir[0], cy = hy + dir[1];

    for (;;) {
      const ch = at(cx, cy);
      if (free(cx, cy) && ch === lineOf(dir)) {
        cells.push([cx, cy]);
        cx += dir[0]; cy += dir[1];
        continue;
      }
      // Opposite-pointing head aligned with our travel: double-headed arrow.
      if (free(cx, cy) && ch in HEAD_DIR && HEAD_DIR[ch][0] === dir[0] && HEAD_DIR[ch][1] === dir[1]) {
        cells.push([cx, cy]);
        dual = true;
        break;
      }
      if (ch === '+') {
        // Crossing/junction: prefer continuing straight through.
        const sx = cx + dir[0], sy = cy + dir[1];
        if (at(sx, sy) === lineOf(dir) && free(sx, sy)) {
          if (free(cx, cy)) { cells.push([cx, cy]); } // shared junction may be consumed
          cx = sx; cy = sy;
          continue;
        }
        if (free(cx, cy)) {
          // Bend: turn onto the perpendicular continuation.
          cells.push([cx, cy]);
          const options: [number, number][] = dir[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
          const turn = options.find(([px, py]) => {
            const nc = at(cx + px, cy + py);
            return free(cx + px, cy + py) && (nc === lineOf([px, py]) || nc === '+');
          });
          if (!turn) break;
          dir = turn;
          cx += dir[0]; cy += dir[1];
          continue;
        }
        break;
      }
      // Gap: embedded label (horizontal) or label overlay (vertical).
      const maxGap = dir[1] === 0 ? 40 : 4;
      let resume = -1;
      let blocked = false;
      const gap: [number, number][] = [];
      for (let i = 0; i < maxGap; i++) {
        const gx = cx + dir[0] * i, gy = cy + dir[1] * i;
        const gc = at(gx, gy);
        if (i > 0 && gc === lineOf(dir) && free(gx, gy)) { resume = i; break; }
        if (gc === '-' || gc === '|' || gc === '+' || gc in HEAD_DIR) { blocked = true; break; }
        gap.push([gx, gy]);
      }
      if (blocked || resume < 0) break;
      if (dir[1] === 0) {
        const chars = gap.map(([gx, gy]) => at(gx, gy));
        if (dir[0] < 0) chars.reverse();
        const s = chars.join('').trim();
        if (s && !label) label = s;
        labelCells.push(...gap);
      }
      cx += dir[0] * resume;
      cy += dir[1] * resume;
    }

    if (cells.length < 2) return null;
    for (const [px, py] of cells) take(px, py);
    for (const [px, py] of labelCells) if (at(px, py) !== ' ') take(px, py);
    // also consume label padding spaces so text pass skips them
    for (const [px, py] of labelCells) take(px, py);

    const [tx, ty] = cells[cells.length - 1];
    const box2 = attachedBox(hx, hy);
    let box1 = attachedBox(tx, ty);
    if (box1 != null && box1 === box2) box1 = null;
    const a: ArrowShape = { type: 'arrow', id: seq++, x1: tx, y1: ty, x2: hx, y2: hy, box1, box2 };
    if (label) a.text = label;
    if (dual) a.heads = 'both';
    return a;
  }

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < lines[y].length; x++) {
      const c = at(x, y);
      if (!(c in HEAD_DIR) || !free(x, y)) continue;
      const a = traceArrow(x, y, HEAD_DIR[c]);
      if (a) arrows.push(a);
    }
  }


  /* ---------- box labels from remaining interior text ---------- */

  for (const b of boxes) {
    const overlapped = boxes.some(
      (o) =>
        o !== b &&
        o.x < b.x + b.w - 1 && o.x + o.w > b.x + 1 &&
        o.y < b.y + b.h - 1 && o.y + o.h > b.y + 1,
    );
    if (overlapped) continue;
    const rows: string[] = [];
    for (let j = b.y + 1; j < b.y + b.h - 1; j++) {
      let row = '';
      for (let i = b.x + 1; i < b.x + b.w - 1; i++) {
        row += free(i, j) ? at(i, j) : ' ';
        if (free(i, j) && at(i, j) !== ' ') take(i, j);
      }
      rows.push(row.trim());
    }
    while (rows.length && !rows[0]) rows.shift();
    while (rows.length && !rows[rows.length - 1]) rows.pop();
    b.text = rows.join('\n');
  }

  /* ---------- leftover characters become free text ---------- */

  for (let y = 0; y < H; y++) {
    const L = lines[y];
    let x = 0;
    while (x < L.length) {
      if (at(x, y) === ' ' || !free(x, y)) { x++; continue; }
      let end = x;
      let i = x;
      while (i < L.length && free(i, y)) {
        if (at(i, y) !== ' ') { end = i; i++; continue; }
        // allow single interior spaces
        if (i + 1 < L.length && at(i + 1, y) !== ' ' && free(i + 1, y)) { i++; continue; }
        break;
      }
      texts.push({ type: 'text', id: seq++, x, y, text: L.slice(x, end + 1) });
      for (let j = x; j <= end; j++) take(j, y);
      x = end + 1;
    }
  }

  return [...groups, ...boxes, ...arrows, ...texts];
}
