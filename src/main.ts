import './style.css';
import { LEGACY_KEY, STORE_INDEX } from './constants';
import { exportAscii } from './export';
import { initInteractions } from './interactions';
import { rasterize } from './raster';
import { render, setupCanvas } from './render';
import { app, genId, loadDoc, save, uid } from './store';
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
  updateProjectBar();
}

setupCanvas();
initUi();
initInteractions();
boot();
render();

// test hook
declare global {
  interface Window { __app: unknown }
}
window.__app = {
  get doc() { return app.doc; },
  set doc(d: DocState) { app.doc = d; app.selection = new Set(); render(); },
  get selection() { return [...app.selection]; },
  get projects() { return app.projects; },
  render,
  exportAscii: () => exportAscii(app.doc.shapes),
  rasterize,
  setTool,
  switchProject,
};
