import './style.css';
import { LEGACY_KEY, LEGACY_PREFIX, STORE_INDEX } from './constants';
import { exportAscii } from './export';
import { decodeShareLink, encodeShareLink, remapIds } from './interop';
import { initInteractions } from './interactions';
import { rasterize } from './raster';
import { render, setupCanvas } from './render';
import { app, genId, loadDoc, loadHistory, loadZoom, resetView, save, uid } from './store';
import type { DocState } from './types';
import { initUi, setTool, switchProject, updateProjectBar } from './ui';

function demo(): void {
  app.doc = { seq: 1, shapes: [] };
  const browser = { type: 'box' as const, id: uid(), x: 6, y: 4, w: 16, h: 5, text: 'Browser' };
  const server = { type: 'box' as const, id: uid(), x: 40, y: 3, w: 18, h: 7, text: 'Web\nServer' };
  const db = { type: 'box' as const, id: uid(), x: 41, y: 16, w: 16, h: 5, text: 'Database' };
  app.doc.shapes.push(
    browser, server, db,
    { type: 'arrow', id: uid(), x1: 0, y1: 0, x2: 0, y2: 0, box1: browser.id, box2: server.id },
    { type: 'arrow', id: uid(), x1: 0, y1: 0, x2: 0, y2: 0, box1: server.id, box2: db.id },
    { type: 'text', id: uid(), x: 6, y: 1, text: 'GET /index.html' },
  );
}

/** One-time storage migration from the previous release's key prefix. */
function migrateLegacyStore(): void {
  try {
    if (localStorage.getItem(STORE_INDEX) || !localStorage.getItem(LEGACY_PREFIX + 'index')) return;
    const moved: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(LEGACY_PREFIX)) moved.push(key);
    }
    for (const key of moved) {
      const value = localStorage.getItem(key);
      if (value != null) localStorage.setItem('ptd:' + key.slice(LEGACY_PREFIX.length), value);
      localStorage.removeItem(key);
    }
  } catch { /* storage unavailable — start fresh */ }
}

function boot(): void {
  let idx: { projects?: unknown; current?: unknown } | null = null;
  try { idx = JSON.parse(localStorage.getItem(STORE_INDEX) ?? 'null'); } catch { /* corrupt index */ }
  if (idx && Array.isArray(idx.projects) && idx.projects.length) {
    app.projects = idx.projects;
    app.currentProject = app.projects.some((p) => p.id === idx.current)
      ? (idx.current as string)
      : app.projects[0].id;
    app.doc = loadDoc(app.currentProject) ?? { seq: 1, shapes: [] };
  } else {
    app.projects = [{ id: genId(), name: 'Untitled' }];
    app.currentProject = app.projects[0].id;
    let legacy: DocState | null = null;
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? 'null'); } catch { /* ignore */ }
    if (legacy && Array.isArray(legacy.shapes)) {
      app.doc = legacy;
      try { localStorage.removeItem(LEGACY_KEY); } catch { /* ignore */ }
    } else {
      demo();
    }
    save();
  }
  loadHistory(app.currentProject);
  updateProjectBar();
}

migrateLegacyStore();
loadZoom();
boot();
setupCanvas();
initUi();
initInteractions();
render();

/** A #s= share link imports as a new project (existing projects untouched). */
async function importShareHash(): Promise<void> {
  if (self !== top) return; // ignore share hashes inside an iframe — drive-by import guard
  if (!location.hash.startsWith('#s=')) return;
  const frag = location.hash.slice(3);
  history.replaceState(null, '', location.pathname + location.search);
  const decoded = await decodeShareLink(frag);
  if ('error' in decoded) {
    document.querySelector('#hint')!.textContent =
      'This share link could not be opened — ' + decoded.error;
    return;
  }
  // Remap untrusted ids to a fresh 1..N sequence. Incoming ids are attacker-
  // controlled; a value >= 2^53 would saturate uid() and collide every new shape.
  let seq = 1;
  remapIds(decoded.shapes, () => seq++);
  const id = genId();
  app.projects.push({ id, name: decoded.name || 'Shared' });
  app.doc = { seq, shapes: decoded.shapes };
  app.currentProject = id;
  resetView();
  save();
  updateProjectBar();
  render();
}
void importShareHash();
addEventListener('hashchange', () => void importShareHash());

// test hook
declare global {
  interface Window { __app: unknown }
}
window.__app = {
  get doc() { return app.doc; },
  set doc(d: DocState) { app.doc = d; app.selection = new Set(); render(); },
  get selection() { return [...app.selection]; },
  get projects() { return app.projects; },
  /** Last painted raster — reflects render-time label hiding. */
  get grid() { return app.grid; },
  render,
  exportAscii: () => exportAscii(app.doc.shapes),
  rasterize,
  setTool,
  switchProject,
  /** Test seam: full share URL for the current project. */
  shareLink: async () => {
    const name = app.projects.find((p) => p.id === app.currentProject)?.name ?? 'Shared';
    return location.origin + location.pathname + '#s=' + await encodeShareLink(name, app.doc.shapes);
  },
};
