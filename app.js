'use strict';

/* ============================================================
 * vibedraw — grid-first diagram editor.
 * Everything lives on a character grid; the same rasterizer
 * paints the canvas and produces the ASCII export.
 * ============================================================ */

// ---------- constants ----------
const CW = 10, CH = 18;            // cell size, px
const COLS = 200, ROWS = 100;      // world size, cells
const FONT = '15px "SF Mono", ui-monospace, Menlo, Consolas, monospace';
const STORE_INDEX = 'vibedraw:index';
const DOC_KEY = (id) => 'vibedraw:doc:' + id;
const LEGACY_KEY = 'asciidraw-v1';

const PRI = { boxfill: 1, boxborder: 2, line: 3, head: 4, text: 5 };

const COLOR = {
  bg: '#0f1115',
  dot: '#1d2330',
  box: '#cdd6f4',
  arrow: '#7dcfff',
  text: '#e0af68',
  sel: '#7aa2f7',
  selBg: 'rgba(122,162,247,0.22)',
  hoverBg: 'rgba(255,255,255,0.06)',
};

// ---------- state ----------
let state = { seq: 1, shapes: [] };
let tool = 'select';
let selection = new Set();         // selected shape ids
let hoverId = null;
let editing = null;                // shape id being text-edited
let drag = null;                   // active pointer interaction
let grid = null;                   // last raster (hit-testing)
let undoStack = [], redoStack = [];

// ---------- dom ----------
const $ = (s) => document.querySelector(s);
const canvas = $('#canvas');
const world = $('#world');
const stage = $('#stage');
const hintBar = $('#hint');
const modal = $('#modal');
const ctx = canvas.getContext('2d');

// ---------- helpers ----------
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const uid = () => state.seq++;
const getShape = (id) => state.shapes.find((s) => s.id === id) || null;
const getBox = (id) => {
  const s = id != null ? getShape(id) : null;
  return s && s.type === 'box' ? s : null;
};
const snapshot = () => JSON.stringify(state);
const clone = (o) => JSON.parse(JSON.stringify(o));
const soleSel = () => (selection.size === 1 ? getShape([...selection][0]) : null);

function pushUndo(snap) {
  undoStack.push(snap != null ? snap : snapshot());
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
}
function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  state = JSON.parse(undoStack.pop());
  selection = new Set(); hoverId = null;
  save(); render();
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  state = JSON.parse(redoStack.pop());
  selection = new Set(); hoverId = null;
  save(); render();
}

/* ---------- projects ---------- */
let projects = [];        // [{ id, name }]
let currentProject = null;

const genId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const projectName = () => projects.find((p) => p.id === currentProject)?.name || 'diagram';

function save() {
  try {
    localStorage.setItem(DOC_KEY(currentProject), snapshot());
    localStorage.setItem(STORE_INDEX, JSON.stringify({ projects, current: currentProject }));
  } catch { /* private mode / quota */ }
}

function loadDoc(id) {
  try {
    const s = JSON.parse(localStorage.getItem(DOC_KEY(id)));
    return s && Array.isArray(s.shapes) ? s : null;
  } catch { return null; }
}

function resetView() {
  selection = new Set();
  hoverId = null;
  undoStack = [];
  redoStack = [];
  drag = null;
}

function switchProject(id) {
  if (editing) commitEdit();
  if (!projects.some((p) => p.id === id)) return;
  currentProject = id;
  state = loadDoc(id) || { seq: 1, shapes: [] };
  resetView();
  save();
  updateProjectBar();
  render();
}

function newProject() {
  if (editing) commitEdit();
  const name = (prompt('Project name', 'Untitled ' + (projects.length + 1)) || '').trim();
  if (!name) return;
  const p = { id: genId(), name };
  projects.push(p);
  currentProject = p.id;
  state = { seq: 1, shapes: [] };
  resetView();
  save();
  updateProjectBar();
  render();
}

function renameProject() {
  const p = projects.find((pr) => pr.id === currentProject);
  if (!p) return;
  const name = (prompt('Project name', p.name) || '').trim();
  if (!name) return;
  p.name = name;
  save();
  updateProjectBar();
}

function deleteProject() {
  const p = projects.find((pr) => pr.id === currentProject);
  if (!p || !confirm(`Delete project "${p.name}" and its diagram?`)) return;
  try { localStorage.removeItem(DOC_KEY(p.id)); } catch { /* ignore */ }
  projects = projects.filter((pr) => pr.id !== p.id);
  if (!projects.length) projects.push({ id: genId(), name: 'Untitled' });
  switchProject(projects[0].id);
}

function updateProjectBar() {
  const sel = $('#project');
  sel.innerHTML = '';
  for (const p of projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = currentProject;
  document.title = projectName() + ' — vibedraw';
}

/* ============================================================
 * Rasterizer — shapes → character grid
 * ============================================================ */

function rasterize(shapes) {
  const N = COLS * ROWS;
  const ch = new Array(N).fill(' ');
  const id = new Int32Array(N);
  const pri = new Uint8Array(N);

  function put(x, y, c, sid, p) {
    if (x < 0 || y < 0 || x >= COLS || y >= ROWS) return;
    const i = y * COLS + x;
    if (p === PRI.line && pri[i] === PRI.line) {
      // line-over-line: keep/create junctions
      if (ch[i] === '+') { id[i] = sid; return; }
      if ((c === '-' && ch[i] === '|') || (c === '|' && ch[i] === '-')) {
        ch[i] = '+'; id[i] = sid; return;
      }
    }
    if (p >= pri[i]) { ch[i] = c; id[i] = sid; pri[i] = p; }
  }

  for (const s of shapes) {
    if (s.type === 'box') drawBox(s, put);
    else if (s.type === 'arrow') drawArrow(s, put);
    else if (s.type === 'text') drawText(s, put);
  }
  return { ch, id, pri };
}

function drawBox(s, put) {
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

function drawText(s, put) {
  const lines = (s.text || '').split('\n');
  lines.forEach((line, li) => {
    for (let k = 0; k < line.length; k++)
      put(s.x + k, s.y + li, line[k], s.id, PRI.text);
  });
}

function drawArrow(s, put) {
  const pts = resolveArrow(s);
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

  const a = pts[pts.length - 2], b = pts[pts.length - 1];
  const head = b.x > a.x ? '>' : b.x < a.x ? '<' : b.y > a.y ? 'v' : '^';
  put(b.x, b.y, head, s.id, PRI.head);

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

// Cell at half the walked length of an orthogonal path.
function pathMidpoint(pts) {
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

// Pick the border side facing `o`, return the cell just OUTSIDE it.
function anchor(b, o) {
  const cx = b.x + (b.w - 1) / 2, cy = b.y + (b.h - 1) / 2;
  const dx = (o.x - cx) / Math.max(1, b.w / 2);
  const dy = (o.y - cy) / Math.max(1, b.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { x: dx >= 0 ? b.x + b.w : b.x - 1, y: clamp(o.y, b.y + 1, b.y + b.h - 2), axis: 'h' };
  }
  return { x: clamp(o.x, b.x + 1, b.x + b.w - 2), y: dy >= 0 ? b.y + b.h : b.y - 1, axis: 'v' };
}

const center = (b) => ({ x: b.x + (b.w >> 1), y: b.y + (b.h >> 1) });

// Orthogonal route between two (possibly box-attached) endpoints.
function resolveArrow(a) {
  const b1 = getBox(a.box1), b2 = getBox(a.box2);
  let p1 = { x: a.x1, y: a.y1 }, p2 = { x: a.x2, y: a.y2 };
  let ax1 = null, ax2 = null;
  const o1 = b2 ? center(b2) : p2;
  const o2 = b1 ? center(b1) : p1;
  if (b1) { const an = anchor(b1, o1); p1 = { x: an.x, y: an.y }; ax1 = an.axis; a.x1 = an.x; a.y1 = an.y; }
  if (b2) { const an = anchor(b2, o2); p2 = { x: an.x, y: an.y }; ax2 = an.axis; a.x2 = an.x; a.y2 = an.y; }

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

  let pts;
  if (ax1 === 'h' && ax2 === 'h') {
    if (dy === 0) pts = [p1, p2];
    else {
      const mx = (p1.x + p2.x) >> 1;
      pts = [p1, { x: mx, y: p1.y }, { x: mx, y: p2.y }, p2];
    }
  } else if (ax1 === 'v' && ax2 === 'v') {
    if (dx === 0) pts = [p1, p2];
    else {
      const my = (p1.y + p2.y) >> 1;
      pts = [p1, { x: p1.x, y: my }, { x: p2.x, y: my }, p2];
    }
  } else if (ax1 === 'h') {
    pts = [p1, { x: p2.x, y: p1.y }, p2];
  } else {
    pts = [p1, { x: p1.x, y: p2.y }, p2];
  }

  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const last = out[out.length - 1];
    if (pts[i].x !== last.x || pts[i].y !== last.y) out.push(pts[i]);
  }
  return out;
}

/* ============================================================
 * ASCII export
 * ============================================================ */

function exportAscii() {
  const r = rasterize(state.shapes);
  let minX = COLS, minY = ROWS, maxX = -1, maxY = -1;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++)
      if (r.ch[y * COLS + x] !== ' ') {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
  if (maxX < 0) return '';
  const lines = [];
  for (let y = minY; y <= maxY; y++) {
    let line = '';
    for (let x = minX; x <= maxX; x++) line += r.ch[y * COLS + x];
    lines.push(line.replace(/\s+$/, ''));
  }
  return lines.join('\n');
}

/* ============================================================
 * Canvas rendering
 * ============================================================ */

const W = COLS * CW, H = ROWS * CH;
let dotPattern = null;

function setupCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  world.style.width = W + 'px';
  world.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const pc = document.createElement('canvas');
  pc.width = CW; pc.height = CH;
  const p = pc.getContext('2d');
  p.fillStyle = COLOR.bg; p.fillRect(0, 0, CW, CH);
  p.fillStyle = COLOR.dot; p.fillRect(0, 0, 2, 2);
  dotPattern = ctx.createPattern(pc, 'repeat');
}

function shapeColor(s) {
  if (!s) return COLOR.box;
  if (selection.has(s.id)) return COLOR.sel;
  return s.type === 'arrow' ? COLOR.arrow : s.type === 'text' ? COLOR.text : COLOR.box;
}

function render() {
  grid = rasterize(state.shapes);

  ctx.fillStyle = dotPattern || COLOR.bg;
  ctx.fillRect(0, 0, W, H);

  // selection / hover backgrounds
  if (selection.size || hoverId != null) {
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const sid = grid.id[y * COLS + x];
        if (!sid) continue;
        if (selection.has(sid)) {
          ctx.fillStyle = COLOR.selBg;
          ctx.fillRect(x * CW, y * CH, CW, CH);
        } else if (sid === hoverId && tool === 'select') {
          ctx.fillStyle = COLOR.hoverBg;
          ctx.fillRect(x * CW, y * CH, CW, CH);
        }
      }
  }

  // characters
  ctx.font = FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const colorCache = new Map();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const i = y * COLS + x;
      const c = grid.ch[i];
      if (c === ' ') continue;
      const sid = grid.id[i];
      let col = colorCache.get(sid);
      if (!col) { col = shapeColor(getShape(sid)); colorCache.set(sid, col); }
      ctx.fillStyle = col;
      ctx.fillText(c, x * CW + CW / 2, y * CH + CH / 2 + 1);
    }

  drawHandles();

  if (drag && drag.mode === 'marquee') {
    const x = Math.min(drag.sx, drag.cx), y = Math.min(drag.sy, drag.cy);
    const w = Math.abs(drag.cx - drag.sx) + 1, h = Math.abs(drag.cy - drag.sy) + 1;
    ctx.strokeStyle = COLOR.sel;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x * CW + 0.5, y * CH + 0.5, w * CW - 1, h * CH - 1);
    ctx.setLineDash([]);
  }
  updateToolbar();
}

function boxHandles(s) {
  return [
    { c: 'nw', px: s.x * CW, py: s.y * CH },
    { c: 'ne', px: (s.x + s.w) * CW, py: s.y * CH },
    { c: 'sw', px: s.x * CW, py: (s.y + s.h) * CH },
    { c: 'se', px: (s.x + s.w) * CW, py: (s.y + s.h) * CH },
  ];
}

function drawHandles() {
  const s = soleSel();
  if (!s || editing) return;
  ctx.fillStyle = COLOR.sel;
  ctx.strokeStyle = COLOR.bg;
  if (s.type === 'box') {
    for (const h of boxHandles(s)) {
      ctx.fillRect(h.px - 4, h.py - 4, 8, 8);
      ctx.strokeRect(h.px - 4, h.py - 4, 8, 8);
    }
  } else if (s.type === 'arrow') {
    for (const [x, y] of [[s.x1, s.y1], [s.x2, s.y2]]) {
      ctx.beginPath();
      ctx.arc(x * CW + CW / 2, y * CH + CH / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
}

/* ============================================================
 * Hit testing
 * ============================================================ */

const cellAt = (px, py) => ({
  x: clamp(Math.floor(px / CW), 0, COLS - 1),
  y: clamp(Math.floor(py / CH), 0, ROWS - 1),
});

function shapeIdAt(cx, cy) {
  if (!grid) return null;
  return grid.id[cy * COLS + cx] || null;
}

function boxAt(cx, cy) {
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const s = state.shapes[i];
    if (s.type === 'box' &&
        cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h) return s;
  }
  return null;
}

function handleAt(px, py, s) {
  for (const h of boxHandles(s))
    if (Math.abs(px - h.px) <= 7 && Math.abs(py - h.py) <= 7) return h.c;
  return null;
}

function endpointAt(px, py, s) {
  const d1 = Math.hypot(px - (s.x1 * CW + CW / 2), py - (s.y1 * CH + CH / 2));
  const d2 = Math.hypot(px - (s.x2 * CW + CW / 2), py - (s.y2 * CH + CH / 2));
  if (d2 <= 9 && d2 <= d1) return 2;
  if (d1 <= 9) return 1;
  return null;
}

/* ============================================================
 * Pointer interactions
 * ============================================================ */

function eventPos(e) {
  const r = canvas.getBoundingClientRect();
  return { px: e.clientX - r.left, py: e.clientY - r.top };
}

// Perimeter cell of a box (arrow-start zone when the box is selected).
function onBoxBorder(s, cx, cy) {
  if (cx < s.x || cx >= s.x + s.w || cy < s.y || cy >= s.y + s.h) return false;
  return cx === s.x || cx === s.x + s.w - 1 || cy === s.y || cy === s.y + s.h - 1;
}

canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  if (editing) commitEdit();
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);

  if (tool === 'select') {
    const sel = soleSel();
    if (sel && sel.type === 'box') {
      const corner = handleAt(px, py, sel);
      if (corner) {
        drag = { mode: 'resize', id: sel.id, corner, orig: clone(sel), snap: snapshot(), moved: false };
        return;
      }
    }
    // Drag from a selected box's border starts a new arrow attached to it.
    if (sel && sel.type === 'box' && !e.shiftKey && onBoxBorder(sel, cx, cy)) {
      const id = uid();
      state.shapes.push({ type: 'arrow', id, x1: cx, y1: cy, x2: cx, y2: cy, box1: sel.id, box2: null });
      drag = { mode: 'create-arrow', id, snap: snapshot(), moved: false };
      render();
      return;
    }
    if (sel && sel.type === 'arrow') {
      const which = endpointAt(px, py, sel);
      if (which) {
        drag = { mode: 'endpoint', id: sel.id, which, snap: snapshot(), moved: false };
        return;
      }
    }
    const hit = shapeIdAt(cx, cy);
    if (hit) {
      if (e.shiftKey) {
        selection.has(hit) ? selection.delete(hit) : selection.add(hit);
      } else {
        if (!selection.has(hit)) selection = new Set([hit]);
        const orig = new Map();
        for (const id of selection) {
          const s = getShape(id);
          if (s) orig.set(id, clone(s));
        }
        drag = { mode: 'move', sx: cx, sy: cy, orig, snap: snapshot(), moved: false };
      }
    } else {
      const base = e.shiftKey ? new Set(selection) : new Set();
      if (!e.shiftKey) selection = new Set();
      drag = { mode: 'marquee', sx: cx, sy: cy, cx, cy, base, moved: false };
    }
    render();
  } else if (tool === 'box') {
    drag = { mode: 'create-box', sx: cx, sy: cy, id: null, snap: snapshot(), moved: false };
  } else if (tool === 'arrow') {
    const id = uid();
    const b = boxAt(cx, cy);
    state.shapes.push({ type: 'arrow', id, x1: cx, y1: cy, x2: cx, y2: cy, box1: b ? b.id : null, box2: null });
    drag = { mode: 'create-arrow', id, snap: snapshot(), moved: false };
    render();
  } else if (tool === 'text') {
    const snap = snapshot();
    const id = uid();
    const t = { type: 'text', id, x: cx, y: cy, text: '' };
    state.shapes.push(t);
    pushUndo(snap);
    selection = new Set([id]);
    setTool('select');
    render();
    startEdit(t);
  }
});

window.addEventListener('mousemove', (e) => {
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);
  hintBar.textContent = hintText(cx, cy);

  if (!drag) {
    updateCursor(px, py, cx, cy);
    return;
  }
  drag.moved = true;

  if (drag.mode === 'move') {
    const dx = cx - drag.sx, dy = cy - drag.sy;
    for (const [id, o] of drag.orig) {
      const s = getShape(id);
      if (s) placeFrom(s, o, dx, dy);
    }
  } else if (drag.mode === 'marquee') {
    drag.cx = cx; drag.cy = cy;
    const x1 = Math.min(drag.sx, cx), x2 = Math.max(drag.sx, cx);
    const y1 = Math.min(drag.sy, cy), y2 = Math.max(drag.sy, cy);
    const next = new Set(drag.base);
    if (grid)
      for (let y = y1; y <= y2; y++)
        for (let x = x1; x <= x2; x++) {
          const sid = grid.id[y * COLS + x];
          if (sid) next.add(sid);
        }
    selection = next;
  } else if (drag.mode === 'resize') {
    const s = getShape(drag.id), o = drag.orig;
    if (!s) return;
    let x1 = o.x, y1 = o.y, x2 = o.x + o.w - 1, y2 = o.y + o.h - 1;
    if (drag.corner.includes('w')) x1 = Math.min(cx, x2 - 2);
    if (drag.corner.includes('e')) x2 = Math.max(cx, x1 + 2);
    if (drag.corner.includes('n')) y1 = Math.min(cy, y2 - 2);
    if (drag.corner.includes('s')) y2 = Math.max(cy, y1 + 2);
    s.x = clamp(x1, 0, COLS - 3); s.y = clamp(y1, 0, ROWS - 3);
    s.w = x2 - s.x + 1; s.h = y2 - s.y + 1;
  } else if (drag.mode === 'endpoint') {
    const s = getShape(drag.id);
    if (!s) return;
    const b = boxAt(cx, cy);
    s['x' + drag.which] = cx;
    s['y' + drag.which] = cy;
    s['box' + drag.which] = b ? b.id : null;
  } else if (drag.mode === 'create-box') {
    let s = drag.id ? getShape(drag.id) : null;
    if (!s) {
      s = { type: 'box', id: uid(), x: drag.sx, y: drag.sy, w: 3, h: 3, text: '' };
      state.shapes.push(s);
      drag.id = s.id;
    }
    s.x = Math.min(drag.sx, cx);
    s.y = Math.min(drag.sy, cy);
    s.w = Math.max(3, Math.abs(cx - drag.sx) + 1);
    s.h = Math.max(3, Math.abs(cy - drag.sy) + 1);
  } else if (drag.mode === 'create-arrow') {
    const s = getShape(drag.id);
    if (!s) return;
    const b = boxAt(cx, cy);
    s.x2 = cx; s.y2 = cy;
    s.box2 = b && b.id !== s.box1 ? b.id : null;
  }
  render();
});

window.addEventListener('mouseup', () => {
  if (!drag) return;
  const d = drag;
  drag = null;

  if (d.mode === 'create-box') {
    if (d.id) {
      pushUndo(d.snap);
      selection = new Set([d.id]);
      setTool('select');
    }
  } else if (d.mode === 'create-arrow') {
    const s = getShape(d.id);
    const degenerate = !d.moved || (s && s.x1 === s.x2 && s.y1 === s.y2 && !s.box2);
    if (degenerate) {
      state.shapes = state.shapes.filter((sh) => sh.id !== d.id);
    } else {
      pushUndo(d.snap);
      selection = new Set([d.id]);
      setTool('select');
    }
  } else if (d.moved && d.snap) {
    pushUndo(d.snap);
  }
  save();
  render();
});

canvas.addEventListener('dblclick', (e) => {
  const { px, py } = eventPos(e);
  const { x: cx, y: cy } = cellAt(px, py);
  const s = getShape(shapeIdAt(cx, cy));
  if (s) {
    selection = new Set([s.id]);
    render();
    startEdit(s);
  } else {
    const snap = snapshot();
    const t = { type: 'text', id: uid(), x: cx, y: cy, text: '' };
    state.shapes.push(t);
    pushUndo(snap);
    selection = new Set([t.id]);
    render();
    startEdit(t);
  }
});

function updateCursor(px, py, cx, cy) {
  let cur = 'default';
  if (tool === 'box' || tool === 'arrow') cur = 'crosshair';
  else if (tool === 'text') cur = 'text';
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
    if (hit !== hoverId) { hoverId = hit; render(); }
  }
  canvas.style.cursor = cur;
}

/* ============================================================
 * Inline text editing
 * ============================================================ */

let editorEl = null;
let editSnap = null;

function measureGlyph() {
  ctx.font = FONT;
  return ctx.measureText('M').width;
}

function startEdit(s, seed) {
  commitEdit();
  editing = s.id;
  editSnap = snapshot();
  const ta = document.createElement('textarea');
  ta.className = 'editor';
  ta.value = seed != null ? seed : (s.text || '');
  ta.style.font = FONT;
  ta.style.lineHeight = CH + 'px';
  ta.style.letterSpacing = (CW - measureGlyph()).toFixed(2) + 'px';

  if (s.type === 'box') {
    const iw = Math.max(1, s.w - 2), ih = Math.max(1, s.h - 2);
    ta.style.left = (s.x + 1) * CW + 'px';
    ta.style.top = (s.y + 1) * CH + 'px';
    ta.style.width = iw * CW + 'px';
    ta.style.height = ih * CH + 'px';
    ta.style.textAlign = 'center';
    const pad = () => {
      const n = ta.value.split('\n').length;
      ta.style.paddingTop = Math.max(0, ((ih - n) >> 1)) * CH + 'px';
    };
    ta.addEventListener('input', pad);
    pad();
  } else {
    let ox = s.x, oy = s.y;
    if (s.type === 'arrow') {
      const mid = pathMidpoint(resolveArrow(s));
      ox = mid.x; oy = mid.y;
    }
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
  }

  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
  });
  ta.addEventListener('blur', () => commitEdit());

  world.appendChild(ta);
  editorEl = ta;
  ta.focus();
  ta.setSelectionRange(ta.value.length, ta.value.length);
  render();
}

function commitEdit() {
  if (!editing || !editorEl) return;
  const s = getShape(editing);
  const value = editorEl.value.replace(/[ \t]+$/gm, '').replace(/\n+$/, '');
  teardownEditor();
  if (s) {
    const changed = (s.text || '') !== value;
    if (s.type === 'text' && !value) {
      pushUndo(editSnap);
      state.shapes = state.shapes.filter((sh) => sh.id !== s.id);
      selection.delete(s.id);
    } else if (changed) {
      pushUndo(editSnap);
      s.text = value;
    }
  }
  editSnap = null;
  save();
  render();
}

function cancelEdit() {
  if (!editing) return;
  const s = getShape(editing);
  teardownEditor();
  if (s && s.type === 'text' && !(s.text || '')) {
    state.shapes = state.shapes.filter((sh) => sh.id !== s.id);
    selection.delete(s.id);
  }
  editSnap = null;
  render();
}

function teardownEditor() {
  editing = null;
  if (editorEl) {
    const el = editorEl;
    editorEl = null;
    el.remove();
  }
}

/* ============================================================
 * Commands
 * ============================================================ */

// Reposition `s` at `o`'s coordinates shifted by (dx, dy).
function placeFrom(s, o, dx, dy) {
  if (s.type === 'box') {
    s.x = clamp(o.x + dx, 0, COLS - s.w);
    s.y = clamp(o.y + dy, 0, ROWS - s.h);
  } else if (s.type === 'text') {
    s.x = clamp(o.x + dx, 0, COLS - 1);
    s.y = clamp(o.y + dy, 0, ROWS - 1);
  } else if (s.type === 'arrow') {
    if (!s.box1) { s.x1 = clamp(o.x1 + dx, 0, COLS - 1); s.y1 = clamp(o.y1 + dy, 0, ROWS - 1); }
    if (!s.box2) { s.x2 = clamp(o.x2 + dx, 0, COLS - 1); s.y2 = clamp(o.y2 + dy, 0, ROWS - 1); }
  }
}

function deleteSelected() {
  if (!selection.size) return;
  pushUndo();
  for (const s of state.shapes) {
    if (s.type !== 'arrow' || selection.has(s.id)) continue;
    if (s.box1 != null && selection.has(s.box1)) s.box1 = null; // x1/y1 hold last resolved anchor
    if (s.box2 != null && selection.has(s.box2)) s.box2 = null;
  }
  state.shapes = state.shapes.filter((sh) => !selection.has(sh.id));
  selection = new Set();
  save();
  render();
}

function nudge(dx, dy) {
  if (!selection.size) return;
  pushUndo();
  for (const id of selection) {
    const s = getShape(id);
    if (s) placeFrom(s, s, dx, dy);
  }
  save();
  render();
}

function clearAll() {
  if (!state.shapes.length) return;
  if (!confirm('Clear the whole canvas?')) return;
  pushUndo();
  state.shapes = [];
  selected = null;
  save();
  render();
}

function openExport() {
  const text = exportAscii();
  $('#out').value = text;
  const lines = text ? text.split('\n') : [];
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  $('#stats').textContent = text
    ? `${lines.length} lines × ${cols} cols · ${text.length} chars`
    : 'canvas is empty';
  modal.hidden = false;
  $('#out').focus();
  $('#out').select();
}

function closeExport() { modal.hidden = true; }

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function flash(btn, label) {
  const old = btn.innerHTML;
  btn.textContent = label;
  setTimeout(() => { btn.innerHTML = old; }, 1200);
}

// Primary export: straight to clipboard. Shift+click previews in the modal.
async function exportToClipboard() {
  const text = exportAscii();
  if (!text) { flash($('#export'), 'Canvas empty'); return; }
  await copyText(text);
  flash($('#export'), 'Copied ✓');
}

async function copyExport() {
  await copyText($('#out').value);
  flash($('#copy'), 'Copied ✓');
}

function downloadExport() {
  const blob = new Blob([$('#out').value + '\n'], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = projectName() + '.txt';
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ============================================================
 * Toolbar / keyboard
 * ============================================================ */

const HINTS = {
  select: 'click: select · shift-click / drag: multi-select · type: edit label · corners: resize · del: delete · arrows: nudge',
  box: 'drag to draw a box, then just type to label it',
  arrow: 'drag from source to target — endpoints inside a box snap to it · select + type to label the arrow',
  text: 'click anywhere to place free-standing text',
};

function hintText(cx, cy) {
  return `${cx},${cy}   ${HINTS[tool]}`;
}

function setTool(t) {
  tool = t;
  if (t !== 'select') { selection = new Set(); hoverId = null; }
  updateToolbar();
  render();
}

function updateToolbar() {
  document.querySelectorAll('#tools button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tool === tool));
  $('#undo').disabled = !undoStack.length;
  $('#redo').disabled = !redoStack.length;
  $('#delete').disabled = !selection.size;
}

document.querySelectorAll('#tools button').forEach((b) =>
  b.addEventListener('click', () => setTool(b.dataset.tool)));
$('#undo').addEventListener('click', undo);
$('#redo').addEventListener('click', redo);
$('#delete').addEventListener('click', deleteSelected);
$('#clear').addEventListener('click', clearAll);
$('#export').addEventListener('click', (e) => e.shiftKey ? openExport() : exportToClipboard());
$('#close').addEventListener('click', closeExport);
$('#copy').addEventListener('click', copyExport);
$('#download').addEventListener('click', downloadExport);
$('#project').addEventListener('change', (e) => { switchProject(e.target.value); e.target.blur(); });
$('#proj-new').addEventListener('click', newProject);
$('#proj-rename').addEventListener('click', renameProject);
$('#proj-delete').addEventListener('click', deleteProject);
modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeExport(); });

window.addEventListener('keydown', (e) => {
  if (editing) return;
  const t = e.target;
  if (t instanceof HTMLTextAreaElement || t instanceof HTMLInputElement || t instanceof HTMLSelectElement) {
    if (e.key === 'Escape' && !modal.hidden) closeExport();
    return;
  }
  if (!modal.hidden) {
    if (e.key === 'Escape') closeExport();
    return;
  }
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    selection = new Set(state.shapes.map((s) => s.id));
    render();
    return;
  }
  if (mod) return;

  switch (e.key) {
    case 'Delete': case 'Backspace': e.preventDefault(); deleteSelected(); return;
    case 'Escape':
      if (drag) { if (drag.snap) state = JSON.parse(drag.snap); drag = null; }
      selection = new Set();
      render();
      return;
    case 'Enter': {
      const s = soleSel();
      if (s) { e.preventDefault(); startEdit(s); }
      return;
    }
    case 'ArrowLeft': e.preventDefault(); nudge(-1, 0); return;
    case 'ArrowRight': e.preventDefault(); nudge(1, 0); return;
    case 'ArrowUp': e.preventDefault(); nudge(0, -1); return;
    case 'ArrowDown': e.preventDefault(); nudge(0, 1); return;
  }

  // Typing with a single shape selected starts label editing (draw.io style).
  const target = soleSel();
  if (target && e.key.length === 1) {
    e.preventDefault();
    startEdit(target, e.key);
    return;
  }

  switch (e.key) {
    case 'v': case 'V': setTool('select'); break;
    case 'b': case 'B': case 'r': case 'R': setTool('box'); break;
    case 'a': case 'A': setTool('arrow'); break;
    case 't': case 'T': setTool('text'); break;
    case 'e': case 'E': e.shiftKey ? openExport() : exportToClipboard(); break;
  }
});

/* ============================================================
 * Boot
 * ============================================================ */

function demo() {
  state = { seq: 1, shapes: [] };
  const browser = { type: 'box', id: uid(), x: 6, y: 4, w: 16, h: 5, text: 'Browser' };
  const server = { type: 'box', id: uid(), x: 40, y: 3, w: 18, h: 7, text: 'Web\nServer' };
  const db = { type: 'box', id: uid(), x: 41, y: 16, w: 16, h: 5, text: 'Database' };
  state.shapes.push(
    browser, server, db,
    { type: 'arrow', id: uid(), x1: 0, y1: 0, x2: 0, y2: 0, box1: browser.id, box2: server.id },
    { type: 'arrow', id: uid(), x1: 0, y1: 0, x2: 0, y2: 0, box1: server.id, box2: db.id },
    { type: 'text', id: uid(), x: 6, y: 1, text: 'GET /index.html' },
  );
}

setupCanvas();
(function boot() {
  let idx = null;
  try { idx = JSON.parse(localStorage.getItem(STORE_INDEX)); } catch { /* corrupt index */ }
  if (idx && Array.isArray(idx.projects) && idx.projects.length) {
    projects = idx.projects;
    currentProject = projects.some((p) => p.id === idx.current) ? idx.current : projects[0].id;
    state = loadDoc(currentProject) || { seq: 1, shapes: [] };
  } else {
    projects = [{ id: genId(), name: 'Untitled' }];
    currentProject = projects[0].id;
    let legacy = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY)); } catch { /* ignore */ }
    if (legacy && Array.isArray(legacy.shapes)) {
      state = legacy;
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    } else {
      demo();
    }
    save();
  }
  updateProjectBar();
})();
hintBar.textContent = hintText(0, 0);
render();

// test hook
window.__app = {
  get state() { return state; },
  set state(s) { state = s; selection = new Set(); render(); },
  get selection() { return [...selection]; },
  get projects() { return projects; },
  render, exportAscii, rasterize, setTool, uid, switchProject,
};
