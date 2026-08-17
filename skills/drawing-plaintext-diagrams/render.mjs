// scripts/render-cli.ts
import { readFileSync } from "node:fs";

// src/constants.ts
var COLS = 200;
var ROWS = 100;
var MAX_COLS = 1000;
var MAX_ROWS = 500;
var PRI = {
  groupborder: 1,
  boxfill: 2,
  boxborder: 3,
  line: 4,
  head: 5,
  text: 6
};

// src/util.ts
var clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// src/shapes.ts
function boxMinSize(s) {
  if (!s.text)
    return [3, 3];
  const padX = 2;
  const lines = s.text.split(`
`);
  return [
    Math.max(3, Math.max(...lines.map((l) => l.length)) + 2 + padX * 2),
    Math.max(3, lines.length + 2)
  ];
}
function fitBoxToLabel(s) {
  const [minW, minH] = boxMinSize(s);
  if (s.w < minW)
    s.w = Math.min(minW, MAX_COLS - s.x);
  if (s.h < minH)
    s.h = Math.min(minH, MAX_ROWS - s.y);
}
function laneBounds(g) {
  const n = g.lanes?.length ?? 0;
  if (n < 2)
    return [];
  return Array.from({ length: n - 1 }, (_, i) => g.x + Math.round((i + 1) * (g.w - 1) / n));
}
function contentExtent(shapes) {
  let x = 0, y = 0;
  for (const s of shapes) {
    if (s.type === "box" || s.type === "group") {
      x = Math.max(x, s.x + s.w);
      y = Math.max(y, s.y + s.h);
    } else if (s.type === "text") {
      const lines = (s.text || "").split(`
`);
      x = Math.max(x, s.x + Math.max(...lines.map((l) => l.length)));
      y = Math.max(y, s.y + lines.length);
    } else {
      const labelHalf = s.text ? (Math.max(...s.text.split(`
`).map((l) => l.length)) >> 1) + 2 : 1;
      x = Math.max(x, Math.max(s.x1, s.x2) + labelHalf);
      y = Math.max(y, Math.max(s.y1, s.y2) + (s.text ? s.text.split(`
`).length : 0) + 1);
    }
  }
  return { x, y };
}

// src/raster.ts
function rasterize(shapes, cols = COLS, rows = ROWS) {
  const N = cols * rows;
  const ch = new Array(N).fill(" ");
  const id = new Int32Array(N);
  const pri = new Uint8Array(N);
  const put = (x, y, c, sid, p) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows)
      return;
    const i = y * cols + x;
    if (p === PRI.line && pri[i] === PRI.line) {
      if (ch[i] === "+") {
        id[i] = sid;
        return;
      }
      if (c === "-" && ch[i] === "|" || c === "|" && ch[i] === "-") {
        ch[i] = "+";
        id[i] = sid;
        return;
      }
      if (c === ":" && ch[i] === "-" || c === "-" && ch[i] === ":") {
        ch[i] = "+";
        id[i] = sid;
        return;
      }
    }
    if (p >= pri[i]) {
      ch[i] = c;
      id[i] = sid;
      pri[i] = p;
    }
  };
  const ghost = (x, y, sid) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows)
      return;
    const i = y * cols + x;
    if (id[i] === 0)
      id[i] = sid;
  };
  const busy = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && pri[y * cols + x] > 0;
  for (const s of shapes)
    if (s.type === "group")
      drawGroup(s, put);
  for (const s of shapes) {
    if (s.type === "box")
      drawBox(s, put);
    else if (s.type === "arrow")
      drawArrow(s, shapes, put, ghost, busy);
    else if (s.type === "text")
      drawText(s, put);
  }
  return { ch, id, pri, cols, rows };
}
function drawGroup(s, put) {
  const { x, y, w, h, id } = s;
  const title = (s.text ?? "").split(`
`)[0];
  const tabbed = !!title && h >= 5;
  const top = tabbed ? y + 2 : y;
  if (tabbed) {
    const tw = Math.min(w, title.length + 4);
    for (let i = 0;i < tw; i++)
      put(x + i, y, "=", id, PRI.groupborder);
    put(x, y, "+", id, PRI.groupborder);
    put(x + tw - 1, y, "+", id, PRI.groupborder);
    put(x, y + 1, "|", id, PRI.groupborder);
    put(x + tw - 1, y + 1, "|", id, PRI.groupborder);
    const t = title.slice(0, Math.max(0, tw - 4));
    for (let k = 0;k < t.length; k++)
      put(x + 2 + k, y + 1, t[k], id, PRI.text);
  }
  for (let i = 0;i < w; i++) {
    put(x + i, top, "=", id, PRI.groupborder);
    put(x + i, y + h - 1, "=", id, PRI.groupborder);
  }
  for (let j = top;j < y + h; j++) {
    put(x, j, "|", id, PRI.groupborder);
    put(x + w - 1, j, "|", id, PRI.groupborder);
  }
  put(x, top, "+", id, PRI.groupborder);
  put(x + w - 1, top, "+", id, PRI.groupborder);
  put(x, y + h - 1, "+", id, PRI.groupborder);
  put(x + w - 1, y + h - 1, "+", id, PRI.groupborder);
  if (tabbed) {
    put(x + Math.min(w, title.length + 4) - 1, top, "+", id, PRI.groupborder);
  }
  if (!tabbed && s.text && h > 2) {
    const t = title.slice(0, Math.max(0, w - 4));
    for (let k = 0;k < t.length; k++)
      put(x + 2 + k, y + 1, t[k], id, PRI.text);
  }
  const n = s.lanes?.length ?? 0;
  if (n >= 2 && y + h - 1 - top >= 4) {
    const bounds = laneBounds(s);
    const u = top + 2;
    for (let i = 1;i < w - 1; i++)
      put(x + i, u, "=", id, PRI.groupborder);
    put(x, u, "+", id, PRI.groupborder);
    put(x + w - 1, u, "+", id, PRI.groupborder);
    for (const bx of bounds) {
      for (let j = top + 1;j < y + h - 1; j++)
        put(bx, j, "|", id, PRI.groupborder);
      put(bx, top, "+", id, PRI.groupborder);
      put(bx, u, "+", id, PRI.groupborder);
      put(bx, y + h - 1, "+", id, PRI.groupborder);
    }
    const edges = [x, ...bounds, x + w - 1];
    for (let li = 0;li < n; li++) {
      const lo = edges[li] + 2, hi = edges[li + 1] - 1;
      const t = (s.lanes[li] ?? "").slice(0, Math.max(0, hi - lo));
      for (let k = 0;k < t.length; k++)
        put(lo + k, top + 1, t[k], id, PRI.text);
    }
  }
}
function drawBox(s, put) {
  const { x, y, w, h, id } = s;
  for (let j = 1;j < h - 1; j++)
    for (let i = 1;i < w - 1; i++)
      put(x + i, y + j, " ", id, PRI.boxfill);
  for (let i = 0;i < w; i++) {
    put(x + i, y, "-", id, PRI.boxborder);
    put(x + i, y + h - 1, "-", id, PRI.boxborder);
  }
  for (let j = 0;j < h; j++) {
    put(x, y + j, "|", id, PRI.boxborder);
    put(x + w - 1, y + j, "|", id, PRI.boxborder);
  }
  const [tl, tr, bl, br] = s.style === "round" ? [".", ".", "'", "'"] : ["+", "+", "+", "+"];
  put(x, y, tl, id, PRI.boxborder);
  put(x + w - 1, y, tr, id, PRI.boxborder);
  put(x, y + h - 1, bl, id, PRI.boxborder);
  put(x + w - 1, y + h - 1, br, id, PRI.boxborder);
  const iw = w - 2, ih = h - 2;
  if (s.text && iw > 0 && ih > 0) {
    const lines = s.text.split(`
`).slice(0, ih);
    const y0 = y + 1 + (ih - lines.length >> 1);
    lines.forEach((line, li) => {
      const t = line.slice(0, iw);
      const x0 = x + 1 + (iw - t.length >> 1);
      for (let k = 0;k < t.length; k++)
        put(x0 + k, y0 + li, t[k], id, PRI.text);
    });
  }
}
function drawText(s, put) {
  (s.text || "").split(`
`).forEach((line, li) => {
    for (let k = 0;k < line.length; k++)
      put(s.x + k, s.y + li, line[k], s.id, PRI.text);
  });
}
var INTO_HEAD = { left: ">", right: "<", top: "v", bottom: "^" };
function drawArrow(s, shapes, put, ghost, busy) {
  const { pts, into1, into2 } = resolveArrow(s, shapes);
  if (pts.length < 2) {
    put(pts[0].x, pts[0].y, ">", s.id, PRI.head);
    return;
  }
  const dashed = s.style === "dashed";
  const putL = (x, y, c, force) => {
    if (!dashed || force || (x + y) % 2 === 0 || busy(x, y))
      put(x, y, c, s.id, PRI.line);
    else
      ghost(x, y, s.id);
  };
  for (let i = 0;i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (a.y === b.y) {
      const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
      for (let x = lo;x <= hi; x++)
        putL(x, a.y, "-", x <= lo + 1 || x >= hi - 1);
    } else {
      const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
      for (let y = lo;y <= hi; y++)
        put(a.x, y, dashed ? ":" : "|", s.id, PRI.line);
    }
  }
  for (let i = 1;i < pts.length - 1; i++)
    put(pts[i].x, pts[i].y, "+", s.id, PRI.line);
  const heads = s.heads ?? "end";
  if (heads !== "start") {
    const a = pts[pts.length - 2], b = pts[pts.length - 1];
    const head = into2 ?? (b.x > a.x ? ">" : b.x < a.x ? "<" : b.y > a.y ? "v" : "^");
    put(b.x, b.y, head, s.id, PRI.head);
  }
  if (heads !== "end") {
    const a0 = pts[1], b0 = pts[0];
    const tail = into1 ?? (b0.x > a0.x ? ">" : b0.x < a0.x ? "<" : b0.y > a0.y ? "v" : "^");
    put(b0.x, b0.y, tail, s.id, PRI.head);
  }
  if (s.text) {
    const mid = pathMidpoint(pts);
    s.text.split(`
`).forEach((line, li) => {
      const x0 = mid.x - (line.length >> 1);
      const y0 = mid.y + li;
      put(x0 - 1, y0, " ", s.id, PRI.text);
      for (let k = 0;k < line.length; k++)
        put(x0 + k, y0, line[k], s.id, PRI.text);
      put(x0 + line.length, y0, " ", s.id, PRI.text);
    });
  }
}
var UNI_HEAD = { ">": "▶", "<": "◀", v: "▼", "^": "▲" };
var UNI_JUNCTION = {
  3: "─",
  12: "│",
  10: "┌",
  9: "┐",
  6: "└",
  5: "┘",
  11: "┬",
  7: "┴",
  14: "├",
  13: "┤",
  15: "┼"
};
var UNI_GROUP = {
  3: "═",
  12: "║",
  10: "╔",
  9: "╗",
  6: "╚",
  5: "╝",
  11: "╦",
  7: "╩",
  14: "╠",
  13: "╣",
  15: "╬"
};
function stylize(r) {
  const isLinePri = (p) => p === PRI.line || p === PRI.boxborder;
  const connects = (x, y, axis) => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows)
      return false;
    const i = y * r.cols + x;
    if (r.pri[i] === PRI.head) {
      const c = r.ch[i];
      return axis === "h" ? c === "<" || c === ">" : c === "v" || c === "^";
    }
    if (isLinePri(r.pri[i])) {
      const c = r.ch[i];
      return c === "+" || c === (axis === "h" ? "-" : "|") || axis === "v" && c === ":";
    }
    return false;
  };
  const connectsG = (x, y, axis) => {
    if (x < 0 || y < 0 || x >= r.cols || y >= r.rows)
      return false;
    const i = y * r.cols + x;
    if (r.pri[i] !== PRI.groupborder)
      return false;
    const c = r.ch[i];
    return c === "+" || c === (axis === "h" ? "=" : "|");
  };
  const out = new Array(r.cols * r.rows);
  for (let y = 0;y < r.rows; y++)
    for (let x = 0;x < r.cols; x++) {
      const i = y * r.cols + x;
      const c = r.ch[i];
      if (r.pri[i] === PRI.head) {
        out[i] = UNI_HEAD[c] ?? c;
      } else if (r.pri[i] === PRI.groupborder) {
        if (c === "=")
          out[i] = "═";
        else if (c === "|")
          out[i] = "║";
        else if (c === "+") {
          const mask = (connectsG(x - 1, y, "h") ? 1 : 0) | (connectsG(x + 1, y, "h") ? 2 : 0) | (connectsG(x, y - 1, "v") ? 4 : 0) | (connectsG(x, y + 1, "v") ? 8 : 0);
          out[i] = UNI_GROUP[mask] ?? "╬";
        } else
          out[i] = c;
      } else if (isLinePri(r.pri[i])) {
        if (c === "-")
          out[i] = "─";
        else if (c === "|")
          out[i] = "│";
        else if (c === ":")
          out[i] = "┊";
        else if (c === "+") {
          const mask = (connects(x - 1, y, "h") ? 1 : 0) | (connects(x + 1, y, "h") ? 2 : 0) | (connects(x, y - 1, "v") ? 4 : 0) | (connects(x, y + 1, "v") ? 8 : 0);
          out[i] = UNI_JUNCTION[mask] ?? "┼";
        } else if (c === ".") {
          out[i] = connects(x - 1, y, "h") ? "╮" : "╭";
        } else if (c === "'") {
          out[i] = connects(x - 1, y, "h") ? "╯" : "╰";
        } else
          out[i] = c;
      } else
        out[i] = c;
    }
  return out;
}
function pathMidpoint(pts) {
  let total = 0;
  for (let i = 0;i < pts.length - 1; i++)
    total += Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
  let want = total >> 1;
  for (let i = 0;i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    if (want <= len) {
      return { x: a.x + Math.sign(b.x - a.x) * want, y: a.y + Math.sign(b.y - a.y) * want };
    }
    want -= len;
  }
  return pts[0];
}
function anchorOn(b, side, cross) {
  if (side === "right")
    return { x: b.x + b.w, y: clamp(cross, b.y + 1, b.y + b.h - 2), axis: "h" };
  if (side === "left")
    return { x: b.x - 1, y: clamp(cross, b.y + 1, b.y + b.h - 2), axis: "h" };
  if (side === "bottom")
    return { x: clamp(cross, b.x + 1, b.x + b.w - 2), y: b.y + b.h, axis: "v" };
  return { x: clamp(cross, b.x + 1, b.x + b.w - 2), y: b.y - 1, axis: "v" };
}
function sideFor(b, o) {
  const cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2;
  const ndx = (o.x - cx) / Math.max(1, b.w / 2);
  const ndy = (o.y - cy) / Math.max(1, b.h / 2);
  return Math.abs(ndx) >= Math.abs(ndy) ? ndx >= 0 ? "right" : "left" : ndy >= 0 ? "bottom" : "top";
}
function anchorFor(b, o, side, slot, off) {
  const vertical = side === "left" || side === "right";
  const span = vertical ? b.h - 2 : b.w - 2;
  const cap = Math.max(1, span + 1 >> 1);
  if (slot < cap) {
    return { ...anchorOn(b, side, Math.round((vertical ? o.y : o.x) + off)), side };
  }
  const ovf = slot - cap;
  const inset = (Math.floor(ovf / 2) + 1) * 2;
  if (vertical) {
    const oside2 = ovf % 2 ? "bottom" : "top";
    const cross2 = side === "right" ? b.x + b.w - 1 - inset : b.x + inset;
    return { ...anchorOn(b, oside2, cross2), side: oside2 };
  }
  const oside = ovf % 2 ? "right" : "left";
  const cross = side === "bottom" ? b.y + b.h - 1 - inset : b.y + inset;
  return { ...anchorOn(b, oside, cross), side: oside };
}
function resolveArrow(a, shapes) {
  const boxOf = (id) => {
    if (id == null)
      return null;
    const s = shapes.find((sh) => sh.id === id);
    return s && s.type === "box" ? s : null;
  };
  const b1 = boxOf(a.box1), b2 = boxOf(a.box2);
  const center = (b) => ({ x: b.x + (b.w >> 1), y: b.y + (b.h >> 1) });
  const slotOn = (b, side, o, which) => {
    const vertical = side === "left" || side === "right";
    const cellOf = (t) => vertical ? clamp(Math.round(t.y), b.y + 1, b.y + b.h - 2) : clamp(Math.round(t.x), b.x + 1, b.x + b.w - 2);
    const cell = cellOf(o);
    const entries = [];
    for (const s of shapes) {
      if (s.type !== "arrow")
        continue;
      const sb1 = boxOf(s.box1), sb2 = boxOf(s.box2);
      if (sb1 === b) {
        const t = sb2 ? center(sb2) : { x: s.x2, y: s.y2 };
        if (sideFor(b, t) === side && cellOf(t) === cell)
          entries.push({ id: s.id, which: 1 });
      }
      if (sb2 === b) {
        const t = sb1 ? center(sb1) : { x: s.x1, y: s.y1 };
        if (sideFor(b, t) === side && cellOf(t) === cell)
          entries.push({ id: s.id, which: 2 });
      }
    }
    if (entries.length <= 1)
      return { slot: 0, off: 0 };
    const slot = Math.max(0, entries.findIndex((e) => e.id === a.id && e.which === which));
    return { slot, off: (slot % 2 ? -1 : 1) * Math.ceil(slot / 2) * 2 };
  };
  let p1 = { x: a.x1, y: a.y1 }, p2 = { x: a.x2, y: a.y2 };
  let ax1 = null, ax2 = null;
  let side1 = null, side2 = null;
  let off1 = 0, off2 = 0;
  const o1 = b2 ? { x: b2.x + (b2.w >> 1), y: b2.y + (b2.h >> 1) } : p2;
  const o2 = b1 ? { x: b1.x + (b1.w >> 1), y: b1.y + (b1.h >> 1) } : p1;
  if (b1) {
    const side = sideFor(b1, o1);
    const { slot, off: off3 } = slotOn(b1, side, o1, 1);
    off1 = off3;
    const an = anchorFor(b1, o1, side, slot, off3);
    p1 = { x: an.x, y: an.y };
    ax1 = an.axis;
    side1 = an.side;
    a.x1 = an.x;
    a.y1 = an.y;
  }
  if (b2) {
    const side = sideFor(b2, o2);
    const { slot, off: off3 } = slotOn(b2, side, o2, 2);
    off2 = off3;
    const an = anchorFor(b2, o2, side, slot, off3);
    p2 = { x: an.x, y: an.y };
    ax2 = an.axis;
    side2 = an.side;
    a.x2 = an.x;
    a.y2 = an.y;
  }
  const off = off1 !== 0 ? off1 : off2;
  if (ax1 === "h" && ax2 === "h" && side1 !== side2 && Math.abs(p2.y - p1.y) === 1) {
    if (b2 && p1.y > b2.y && p1.y < b2.y + b2.h - 1) {
      p2 = { x: p2.x, y: p1.y };
      a.y2 = p1.y;
    } else if (b1 && p2.y > b1.y && p2.y < b1.y + b1.h - 1) {
      p1 = { x: p1.x, y: p2.y };
      a.y1 = p2.y;
    }
  } else if (ax1 === "v" && ax2 === "v" && side1 !== side2 && Math.abs(p2.x - p1.x) === 1) {
    if (b2 && p1.x > b2.x && p1.x < b2.x + b2.w - 1) {
      p2 = { x: p1.x, y: p2.y };
      a.x2 = p1.x;
    } else if (b1 && p2.x > b1.x && p2.x < b1.x + b1.w - 1) {
      p1 = { x: p2.x, y: p1.y };
      a.x1 = p2.x;
    }
  }
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  if (!ax1 && !ax2) {
    if (dy === 0)
      ax1 = ax2 = "h";
    else if (dx === 0)
      ax1 = ax2 = "v";
    else if (Math.abs(dx) >= Math.abs(dy)) {
      ax1 = "h";
      ax2 = "v";
    } else {
      ax1 = "v";
      ax2 = "h";
    }
  } else if (ax1 && !ax2) {
    ax2 = ax1 === "h" ? dy === 0 ? "h" : "v" : dx === 0 ? "v" : "h";
  } else if (!ax1 && ax2) {
    ax1 = ax2 === "h" ? dy === 0 ? "h" : "v" : dx === 0 ? "v" : "h";
  }
  let pts;
  if (ax1 === "h" && ax2 === "h") {
    if (dy === 0 && !(side1 != null && side1 === side2))
      pts = [p1, p2];
    else {
      const mx = side1 === "left" && side2 === "left" ? Math.min(p1.x, p2.x) - 1 - (Math.abs(off) >> 1) : side1 === "right" && side2 === "right" ? Math.max(p1.x, p2.x) + 1 + (Math.abs(off) >> 1) : (p1.x + p2.x >> 1) + off;
      pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
  } else if (ax1 === "v" && ax2 === "v") {
    if (dx === 0 && !(side1 != null && side1 === side2))
      pts = [p1, p2];
    else {
      const my = side1 === "top" && side2 === "top" ? Math.min(p1.y, p2.y) - 1 - (Math.abs(off) >> 1) : side1 === "bottom" && side2 === "bottom" ? Math.max(p1.y, p2.y) + 1 + (Math.abs(off) >> 1) : (p1.y + p2.y >> 1) + off;
      pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
  } else if (ax1 === "h") {
    const K = 1 + (Math.abs(off) >> 1);
    if (b2 && (side2 === "top" || side2 === "bottom") && (side2 === "top" ? p1.y > p2.y : p1.y < p2.y)) {
      const outY = side2 === "top" ? p2.y - K : p2.y + K;
      const cx = p1.x < p2.x ? b2.x - 1 - K : b2.x + b2.w + K;
      pts = [p1, { x: cx, y: p1.y }, { x: cx, y: outY }, { x: p2.x, y: outY }, p2];
    } else {
      pts = [p1, { x: p2.x, y: p1.y }, p2];
    }
  } else {
    const K = 1 + (Math.abs(off) >> 1);
    if (b1 && (side1 === "top" || side1 === "bottom") && (side1 === "top" ? p2.y > p1.y : p2.y < p1.y)) {
      const outY = side1 === "top" ? p1.y - K : p1.y + K;
      const mx = (p1.x + p2.x >> 1) + off;
      pts = [p1, { x: p1.x, y: outY }, { x: mx, y: outY }, { x: mx, y: p2.y }, p2];
    } else {
      pts = [p1, { x: p1.x, y: p2.y }, p2];
    }
  }
  const out = [pts[0]];
  for (let i = 1;i < pts.length; i++) {
    const last = out[out.length - 1];
    if (pts[i].x !== last.x || pts[i].y !== last.y)
      out.push(pts[i]);
  }
  return {
    pts: out,
    into1: side1 ? INTO_HEAD[side1] : null,
    into2: side2 ? INTO_HEAD[side2] : null
  };
}

// src/export.ts
function exportAscii(shapes) {
  const ext = contentExtent(shapes);
  const cols = Math.min(MAX_COLS, Math.max(1, ext.x + 16));
  const rows = Math.min(MAX_ROWS, Math.max(1, ext.y + 16));
  const r = rasterize(shapes, cols, rows);
  const ch = stylize(r);
  let minX = cols, minY = rows, maxX = -1, maxY = -1;
  for (let y = 0;y < rows; y++)
    for (let x = 0;x < cols; x++)
      if (r.ch[y * cols + x] !== " ") {
        if (x < minX)
          minX = x;
        if (x > maxX)
          maxX = x;
        if (y < minY)
          minY = y;
        if (y > maxY)
          maxY = y;
      }
  if (maxX < 0)
    return "";
  const lines = [];
  for (let y = minY;y <= maxY; y++) {
    let line = "";
    for (let x = minX;x <= maxX; x++)
      line += ch[y * cols + x];
    lines.push(line.replace(/\s+$/, ""));
  }
  return lines.join(`
`);
}

// src/import.ts
var HEAD_DIR = {
  ">": [1, 0],
  "<": [-1, 0],
  v: [0, 1],
  "^": [0, -1]
};
var UNI_TO_ASCII = {
  "─": "-",
  "│": "|",
  "┊": ":",
  "╎": ":",
  "┌": "+",
  "┐": "+",
  "└": "+",
  "┘": "+",
  "├": "+",
  "┤": "+",
  "┬": "+",
  "┴": "+",
  "┼": "+",
  "═": "=",
  "║": "|",
  "╔": "+",
  "╗": "+",
  "╚": "+",
  "╝": "+",
  "╠": "+",
  "╣": "+",
  "╦": "+",
  "╩": "+",
  "╬": "+",
  "╭": ".",
  "╮": ".",
  "╰": "'",
  "╯": "'",
  "▶": ">",
  "►": ">",
  "◀": "<",
  "◄": "<",
  "▼": "v",
  "▲": "^"
};
function parseAscii(text) {
  const normalized = text.replace(/[─│┊╎┌┐└┘├┤┬┴┼═║╔╗╚╝╠╣╦╩╬╭╮╰╯▶►◀◄▼▲]/g, (c) => UNI_TO_ASCII[c]);
  const lines = normalized.replace(/\r\n?/g, `
`).split(`
`).map((l) => l.replace(/\s+$/, ""));
  const H = lines.length;
  const at = (x, y) => y >= 0 && y < H && x >= 0 && x < lines[y].length ? lines[y][x] : " ";
  const consumed = new Set;
  const free = (x, y) => !consumed.has(y * 1e5 + x);
  const take = (x, y) => consumed.add(y * 1e5 + x);
  const isH = (c) => c === "-" || c === "+";
  const isV = (c) => c === "|" || c === "+";
  let seq = 1;
  const groups = [];
  const boxes = [];
  const arrows = [];
  const texts = [];
  const sideOk = (c) => isV(c) || c === "-";
  const takeSide = (x, y) => {
    const c = at(x, y);
    if (c !== "-" && c !== " ")
      take(x, y);
  };
  const takeEdge = (x, y) => {
    const c = at(x, y);
    if (c !== "|" && c !== " ")
      take(x, y);
  };
  function rectBottom(x1, x2, y1, horiz, corner) {
    if (x2 - x1 < 2)
      return null;
    const edgeOk = (c) => horiz(c) || c === "|";
    for (let y2 = y1 + 1;y2 <= H; y2++) {
      const cl = at(x1, y2), cr = at(x2, y2);
      if (!(sideOk(cl) || cl === corner) || !(sideOk(cr) || cr === corner))
        return null;
      if (cl !== corner || cr !== corner || y2 - y1 < 2)
        continue;
      let ok = true, underline = false;
      for (let i = x1 + 1;i < x2 && ok; i++) {
        const c = at(i, y2);
        if (!edgeOk(c))
          ok = false;
        else if (c === "+" && at(i, y2 + 1) === "|")
          underline = true;
      }
      if (!ok || underline)
        continue;
      for (let i = x1;i <= x2; i++) {
        takeEdge(i, y1);
        takeEdge(i, y2);
      }
      for (let j = y1;j <= y2; j++) {
        takeSide(x1, j);
        takeSide(x2, j);
      }
      return y2;
    }
    return null;
  }
  const isHG = (c) => c === "=" || c === "+";
  const topOk = (h) => (c) => h(c) || c === "|";
  function groupAt(x, y) {
    const hgTop = topOk(isHG);
    for (let x2 = x + 1;hgTop(at(x2, y)); x2++) {
      if (at(x2, y) !== "+" || isHG(at(x2 + 1, y)))
        continue;
      if (!lines[y].slice(x + 1, x2).includes("="))
        continue;
      const tabRow = y + 2;
      const isTab = at(x, tabRow) === "+" && at(x2, tabRow) === "+" && sideOk(at(x, y + 1)) && sideOk(at(x2, y + 1)) && at(x2 + 1, tabRow) === "=";
      if (isTab) {
        for (let xr = x2 + 1;hgTop(at(xr, tabRow)); xr++) {
          if (at(xr, tabRow) !== "+" || isHG(at(xr + 1, tabRow)))
            continue;
          const yBot2 = rectBottom(x, xr, tabRow, isHG, "+");
          if (yBot2 == null)
            continue;
          for (let i = x;i <= x2; i++)
            takeEdge(i, y);
          takeSide(x, y + 1);
          takeSide(x2, y + 1);
          let title = "";
          for (let i = x + 2;i <= x2 - 2; i++) {
            title += free(i, y + 1) ? at(i, y + 1) : " ";
            take(i, y + 1);
          }
          return { type: "group", id: seq++, x, y, w: xr - x + 1, h: yBot2 - y + 1, text: title.trim() };
        }
        return null;
      }
      const yBot = rectBottom(x, x2, y, isHG, "+");
      if (yBot != null) {
        return { type: "group", id: seq++, x, y, w: x2 - x + 1, h: yBot - y + 1, text: "" };
      }
    }
    return null;
  }
  function detectLanes(g) {
    const top = g.text && g.h >= 5 ? g.y + 2 : g.y;
    const u = top + 2;
    if (g.y + g.h - 1 - top < 4)
      return;
    if (at(g.x, u) !== "+" || at(g.x + g.w - 1, u) !== "+")
      return;
    let isU = true;
    const bounds = [];
    for (let i = g.x + 1;i < g.x + g.w - 1 && isU; i++) {
      const c = at(i, u);
      if (c === "+" && at(i, u + 1) === "|")
        bounds.push(i);
      else if (!isHG(c) && c !== "|")
        isU = false;
    }
    if (!isU || !bounds.length)
      return;
    if (!bounds.every((bx) => at(bx, top) === "+" && at(bx, g.y + g.h - 1) === "+"))
      return;
    for (let i = g.x + 1;i < g.x + g.w - 1; i++) {
      const c = at(i, u);
      if (c === "=" || c === "+")
        take(i, u);
    }
    for (const bx of bounds) {
      for (let j = top + 1;j < g.y + g.h - 1; j++) {
        if (at(bx, j) === "|")
          take(bx, j);
      }
    }
    const edges = [g.x, ...bounds, g.x + g.w - 1];
    const lanes = [];
    for (let li = 0;li + 1 < edges.length; li++) {
      let t = "";
      for (let i = edges[li] + 1;i < edges[li + 1]; i++) {
        t += free(i, top + 1) ? at(i, top + 1) : " ";
        if (free(i, top + 1) && at(i, top + 1) !== " ")
          take(i, top + 1);
      }
      lanes.push(t.trim());
    }
    g.lanes = lanes;
  }
  for (let y = 0;y < H; y++) {
    for (let x = 0;x < lines[y].length; x++) {
      if (at(x, y) !== "+" || !free(x, y))
        continue;
      const g = groupAt(x, y);
      if (g) {
        detectLanes(g);
        groups.push(g);
      }
    }
  }
  for (let y = 0;y < H; y++) {
    for (let x = 0;x < lines[y].length; x++) {
      const c0 = at(x, y);
      if (c0 !== "+" && c0 !== "." || !free(x, y))
        continue;
      const round = c0 === ".";
      const tr = round ? "." : "+";
      const hTop = topOk(isH);
      for (let x2 = x + 1;hTop(at(x2, y)) || at(x2, y) === tr; x2++) {
        if (at(x2, y) !== tr)
          continue;
        const yBot = rectBottom(x, x2, y, isH, round ? "'" : "+");
        if (yBot != null) {
          const b = { type: "box", id: seq++, x, y, w: x2 - x + 1, h: yBot - y + 1, text: "" };
          if (round)
            b.style = "round";
          boxes.push(b);
          break;
        }
      }
    }
  }
  function attachedBox(px, py) {
    const b = boxes.find((o) => px >= o.x - 1 && px < o.x + o.w + 1 && py >= o.y - 1 && py < o.y + o.h + 1);
    return b ? b.id : null;
  }
  function traceArrow(hx, hy, head) {
    const isLine = (c, v) => v[1] === 0 ? c === "-" : c === "|" || c === ":";
    const back = [-head[0], -head[1]];
    const probes = [
      back,
      ...head[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]]
    ];
    let dir = back;
    for (const p of probes) {
      const c1 = at(hx + p[0], hy + p[1]);
      if (free(hx + p[0], hy + p[1]) && (isLine(c1, p) || c1 === "+")) {
        dir = p;
        break;
      }
      const c2 = at(hx + p[0] * 2, hy + p[1] * 2);
      if (c1 === " " && free(hx + p[0] * 2, hy + p[1] * 2) && isLine(c2, p)) {
        dir = p;
        break;
      }
    }
    const cells = [[hx, hy]];
    const labelCells = [];
    let label = "";
    let dual = false;
    let singleGaps = 0;
    let cx = hx + dir[0], cy = hy + dir[1];
    const railEndsAtHead = (jx, jy, d0) => {
      let x = jx, y = jy;
      let d = d0;
      for (let k = 0;k < 512; k++) {
        x += d[0];
        y += d[1];
        const c = at(x, y);
        if (c in HEAD_DIR)
          return true;
        if (isLine(c, d))
          continue;
        if (c !== "+")
          return false;
        const s2 = at(x + d[0], y + d[1]);
        if (isLine(s2, d) || s2 === "+" || s2 in HEAD_DIR)
          continue;
        const pp = d[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
        const opts = pp.filter(([px, py]) => {
          const c2 = at(x + px, y + py);
          return isLine(c2, [px, py]) || c2 === "+" || c2 in HEAD_DIR;
        });
        if (opts.length !== 1)
          return false;
        d = opts[0];
      }
      return false;
    };
    for (;; ) {
      if (cells.length > 4096)
        break;
      const ch = at(cx, cy);
      if (isLine(ch, dir)) {
        cells.push([cx, cy]);
        cx += dir[0];
        cy += dir[1];
        continue;
      }
      if (free(cx, cy) && ch in HEAD_DIR && HEAD_DIR[ch][0] === dir[0] && HEAD_DIR[ch][1] === dir[1]) {
        cells.push([cx, cy]);
        dual = true;
        break;
      }
      const perp = dir[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
      const perpLine = perp.some(([px, py]) => {
        const pc = at(cx + px, cy + py);
        return isLine(pc, [px, py]) || pc === "+" || pc in HEAD_DIR;
      });
      if (ch === "+" && perpLine) {
        const sx = cx + dir[0], sy = cy + dir[1];
        const straightOk = isLine(at(sx, sy), dir);
        const options = dir[1] === 0 ? [[0, -1], [0, 1]] : [[-1, 0], [1, 0]];
        const turns = options.filter(([px, py]) => {
          const nc = at(cx + px, cy + py);
          return free(cx + px, cy + py) && (isLine(nc, [px, py]) || nc === "+");
        });
        if (straightOk && turns.length === 1 && railEndsAtHead(cx, cy, dir)) {
          if (free(cx, cy))
            cells.push([cx, cy]);
          dir = turns[0];
          cx += dir[0];
          cy += dir[1];
          continue;
        }
        if (straightOk) {
          if (free(cx, cy))
            cells.push([cx, cy]);
          cx = sx;
          cy = sy;
          continue;
        }
        if (free(cx, cy) && turns.length) {
          cells.push([cx, cy]);
          dir = turns[0];
          cx += dir[0];
          cy += dir[1];
          continue;
        }
        break;
      }
      const maxGap = dir[1] === 0 ? 40 : 4;
      let resume = -1;
      let blocked = false;
      const gap = [];
      const contin = (x, y) => {
        const c = at(x, y);
        return isLine(c, dir) || c === "+" || c in HEAD_DIR;
      };
      for (let i = 0;i < maxGap; i++) {
        const gx = cx + dir[0] * i, gy = cy + dir[1] * i;
        const gc = at(gx, gy);
        const nx = gx + dir[0], ny = gy + dir[1];
        const continues = contin(nx, ny) || at(nx, ny) === " " && contin(nx + dir[0], ny + dir[1]);
        const endsAtBorder = !free(nx, ny) && at(nx, ny) !== " ";
        if (i > 0 && (isLine(gc, dir) || gc === "+") && free(gx, gy) && (continues || endsAtBorder)) {
          resume = i;
          break;
        }
        const letterish = (c) => c !== " " && c !== "=" && c !== "-" && c !== "|" && c !== ":" && c !== "+" && !(c in HEAD_DIR);
        if ((gc === "-" || gc === "|" || gc === ":" || gc === "+" || (gc in HEAD_DIR)) && !continues && !(letterish(at(gx - dir[0], gy - dir[1])) || letterish(at(nx, ny)))) {
          blocked = true;
          break;
        }
        gap.push([gx, gy]);
      }
      if (blocked || resume < 0)
        break;
      if (resume === 1 && gap.length === 1 && at(gap[0][0], gap[0][1]) === " ")
        singleGaps++;
      if (dir[1] === 0) {
        const chars = gap.map(([gx, gy]) => at(gx, gy));
        if (dir[0] < 0)
          chars.reverse();
        const s = chars.join("").trim();
        if (s && !label)
          label = s;
        labelCells.push(...gap);
      } else {
        for (const [gx0, gy] of gap) {
          const gx = at(gx0, gy) !== " " ? gx0 : at(gx0 - 1, gy) !== " " ? gx0 - 1 : at(gx0 + 1, gy) !== " " ? gx0 + 1 : gx0;
          if (at(gx, gy) === " " || !free(gx, gy))
            continue;
          const stopChar = (x) => {
            const c = at(x, gy);
            if (c === "|" || c === ":" || c === "=")
              return true;
            if (c !== "-" && c !== "+" && !(c in HEAD_DIR))
              return false;
            const l = at(x - 1, gy), r = at(x + 1, gy);
            return l === "-" || r === "-" || l === "+" || r === "+" || l === " " && r === " ";
          };
          let lo = gx, hi = gx;
          while (free(lo - 1, gy) && !stopChar(lo - 1) && !(at(lo - 1, gy) === " " && at(lo - 2, gy) === " "))
            lo--;
          while (free(hi + 1, gy) && !stopChar(hi + 1) && !(at(hi + 1, gy) === " " && at(hi + 2, gy) === " "))
            hi++;
          const s = lines[gy].slice(lo, hi + 1).trim();
          if (s && !label) {
            label = s;
            for (let i = lo;i <= hi; i++)
              labelCells.push([i, gy]);
          }
        }
      }
      cx += dir[0] * resume;
      cy += dir[1] * resume;
    }
    if (cells.length < 2)
      return null;
    for (const [px, py] of cells)
      take(px, py);
    for (const [px, py] of labelCells)
      if (at(px, py) !== " ")
        take(px, py);
    for (const [px, py] of labelCells)
      take(px, py);
    const [tx, ty] = cells[cells.length - 1];
    const box2 = attachedBox(hx, hy);
    let box1 = attachedBox(tx, ty);
    if (box1 != null && box1 === box2)
      box1 = null;
    const a = { type: "arrow", id: seq++, x1: tx, y1: ty, x2: hx, y2: hy, box1, box2 };
    if (label)
      a.text = label;
    if (dual)
      a.heads = "both";
    const dotted = cells.some(([x, y]) => at(x, y) === ":");
    if (dotted || singleGaps >= 2 && singleGaps * 4 >= cells.length)
      a.style = "dashed";
    return a;
  }
  for (let y = 0;y < H; y++) {
    for (let x = 0;x < lines[y].length; x++) {
      const c = at(x, y);
      if (!(c in HEAD_DIR) || !free(x, y))
        continue;
      const hd = HEAD_DIR[c];
      const axisLine = (ch) => hd[1] === 0 ? ch === "-" : ch === "|" || ch === ":";
      const fw = at(x + hd[0], y + hd[1]);
      const bk = at(x - hd[0], y - hd[1]);
      if (axisLine(fw) && (axisLine(bk) || bk === "+"))
        continue;
      const bk2 = at(x - hd[0] * 2, y - hd[1] * 2);
      if (fw === " " && !axisLine(bk) && bk !== "+" && !(bk === " " && axisLine(bk2)))
        continue;
      const a = traceArrow(x, y, HEAD_DIR[c]);
      if (a)
        arrows.push(a);
    }
  }
  for (const b of boxes) {
    const overlapped = boxes.some((o) => o !== b && o.x < b.x + b.w - 1 && o.x + o.w > b.x + 1 && o.y < b.y + b.h - 1 && o.y + o.h > b.y + 1);
    if (overlapped)
      continue;
    const rows = [];
    for (let j = b.y + 1;j < b.y + b.h - 1; j++) {
      let row = "";
      for (let i = b.x + 1;i < b.x + b.w - 1; i++) {
        row += free(i, j) ? at(i, j) : " ";
        if (free(i, j) && at(i, j) !== " ")
          take(i, j);
      }
      rows.push(row.trim());
    }
    while (rows.length && !rows[0])
      rows.shift();
    while (rows.length && !rows[rows.length - 1])
      rows.pop();
    b.text = rows.join(`
`);
  }
  for (let y = 0;y < H; y++) {
    const L = lines[y];
    let x = 0;
    while (x < L.length) {
      if (at(x, y) === " " || !free(x, y)) {
        x++;
        continue;
      }
      let end = x;
      let i = x;
      while (i < L.length && free(i, y)) {
        if (at(i, y) !== " ") {
          end = i;
          i++;
          continue;
        }
        if (i + 1 < L.length && at(i + 1, y) !== " " && free(i + 1, y)) {
          i++;
          continue;
        }
        break;
      }
      texts.push({ type: "text", id: seq++, x, y, text: L.slice(x, end + 1) });
      for (let j = x;j <= end; j++)
        take(j, y);
      x = end + 1;
    }
  }
  return [...groups, ...boxes, ...arrows, ...texts];
}

// scripts/render-cli.ts
function fail(msg) {
  process.stderr.write("error: " + msg + `
`);
  process.exit(1);
}
var args = process.argv.slice(2);
var check = args.includes("--check");
var file = args.find((a) => a !== "--check");
var raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
var parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  fail("input is not valid JSON: " + String(e));
}
var list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && ("shapes" in parsed) ? parsed.shapes : null;
if (!Array.isArray(list))
  fail('expected a JSON array of shapes, or { "shapes": [...] }');
var shapes = list;
var seq = 1;
var ids = new Set;
for (const s of shapes) {
  if (!s || typeof s !== "object")
    fail("shape is not an object: " + JSON.stringify(s));
  if (!["box", "arrow", "text", "group"].includes(s.type))
    fail(`unknown shape type "${String(s.type)}"`);
  if (s.id == null)
    s.id = -1;
  else
    ids.add(s.id);
}
for (const s of shapes) {
  if (s.id === -1) {
    while (ids.has(seq))
      seq++;
    s.id = seq;
    ids.add(seq);
  }
}
for (const s of shapes) {
  if (s.type === "arrow") {
    const a = s;
    a.x1 ??= 0;
    a.y1 ??= 0;
    a.x2 ??= 0;
    a.y2 ??= 0;
    a.box1 ??= null;
    a.box2 ??= null;
    for (const ref of [a.box1, a.box2]) {
      if (ref != null && !shapes.some((sh) => sh.id === ref && sh.type === "box"))
        fail(`arrow ${a.id} references box id ${ref}, which does not exist`);
    }
    if (a.box1 == null && a.box2 == null && a.x1 === a.x2 && a.y1 === a.y2)
      fail(`arrow ${a.id} needs box1/box2 ids or distinct x1,y1 → x2,y2 coordinates`);
  } else if (s.type === "box") {
    const b = s;
    b.w ??= 3;
    b.h ??= 3;
    fitBoxToLabel(b);
  } else if (s.type === "group") {
    const g = s;
    const [minW, minH] = [Math.max(4, (g.text ?? "").length + 4), g.text ? 5 : 3];
    if ((g.w ?? 0) < minW)
      g.w = minW;
    if ((g.h ?? 0) < minH)
      g.h = minH;
  }
}
var out = exportAscii(shapes);
if (!out)
  fail("diagram rendered empty — no shapes with geometry");
if (check) {
  const re = parseAscii(out);
  const count = (ss, t) => ss.filter((x) => x.type === t).length;
  const labels = (ss) => ss.filter((x) => x.type === "arrow").map((a) => a.text ?? null).filter(Boolean).sort();
  const problems = [];
  for (const t of ["box", "group", "arrow"])
    if (count(shapes, t) !== count(re, t))
      problems.push(`${t} count: drew ${count(shapes, t)}, re-imported ${count(re, t)}`);
  const l1 = labels(shapes), l2 = labels(re);
  if (JSON.stringify(l1) !== JSON.stringify(l2))
    problems.push(`arrow labels: drew ${JSON.stringify(l1)}, re-imported ${JSON.stringify(l2)}`);
  if (count(re, "text") > count(shapes, "text"))
    problems.push(`${count(re, "text") - count(shapes, "text")} stray text fragment(s) — geometry collision likely`);
  if (problems.length) {
    process.stderr.write(`round-trip check FAILED:
  ` + problems.join(`
  `) + `
`);
    process.stderr.write(`hint: shapes probably overlap — spread boxes further apart.
`);
    process.stdout.write(out + `
`);
    process.exit(1);
  }
  process.stderr.write(`round-trip check OK
`);
}
process.stdout.write(out + `
`);
