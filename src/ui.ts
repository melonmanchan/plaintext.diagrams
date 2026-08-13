import { clearAll, deleteSelected, nudge } from './commands';
import { commitEdit, startEdit } from './editor';
import { exportAscii } from './export';
import { render, updateToolbar } from './render';
import { app, genId, loadDoc, pushUndo, redo, resetView, save, soleSel, undo } from './store';
import type { Tool } from './types';

/* ============================================================
 * Toolbar, project bar, export modal, keyboard shortcuts.
 * ============================================================ */

const $ = <T extends Element = HTMLElement>(sel: string): T =>
  document.querySelector<T>(sel)!;

const HINTS: Record<Tool, string> = {
  select: 'click: select · shift-click / drag: multi-select · middle-click: new box · type: edit label · del: delete',
  box: 'drag to draw a box, then just type to label it',
  arrow: 'drag from source to target — endpoints inside a box snap to it · select + type to label the arrow',
  text: 'click anywhere to place free-standing text',
};

export function hintText(cx: number, cy: number): string {
  return `${cx},${cy}   ${HINTS[app.tool]}`;
}

export function setTool(t: Tool): void {
  app.tool = t;
  if (t !== 'select') {
    app.selection = new Set();
    app.hoverId = null;
  }
  updateToolbar();
  render();
}

/* ---------- projects ---------- */

export function updateProjectBar(): void {
  const sel = $<HTMLSelectElement>('#project');
  sel.innerHTML = '';
  for (const p of app.projects) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name;
    sel.appendChild(o);
  }
  sel.value = app.currentProject;
  const name = app.projects.find((p) => p.id === app.currentProject)?.name || 'diagram';
  document.title = name + ' — vibedraw';
}

export function switchProject(id: string): void {
  if (app.editing != null) commitEdit();
  if (!app.projects.some((p) => p.id === id)) return;
  app.currentProject = id;
  app.doc = loadDoc(id) ?? { seq: 1, shapes: [] };
  resetView();
  save();
  updateProjectBar();
  render();
}

function newProject(): void {
  if (app.editing != null) commitEdit();
  const name = (prompt('Project name', 'Untitled ' + (app.projects.length + 1)) ?? '').trim();
  if (!name) return;
  const p = { id: genId(), name };
  app.projects.push(p);
  app.currentProject = p.id;
  app.doc = { seq: 1, shapes: [] };
  resetView();
  save();
  updateProjectBar();
  render();
}

function renameProject(): void {
  const p = app.projects.find((pr) => pr.id === app.currentProject);
  if (!p) return;
  const name = (prompt('Project name', p.name) ?? '').trim();
  if (!name) return;
  p.name = name;
  save();
  updateProjectBar();
}

function deleteProject(): void {
  const p = app.projects.find((pr) => pr.id === app.currentProject);
  if (!p || !confirm(`Delete project "${p.name}" and its diagram?`)) return;
  try { localStorage.removeItem('vibedraw:doc:' + p.id); } catch { /* ignore */ }
  app.projects = app.projects.filter((pr) => pr.id !== p.id);
  if (!app.projects.length) app.projects.push({ id: genId(), name: 'Untitled' });
  switchProject(app.projects[0].id);
}

/* ---------- export modal ---------- */

async function copyText(text: string): Promise<void> {
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

function flash(btn: HTMLButtonElement, label: string): void {
  const old = btn.innerHTML;
  btn.textContent = label;
  setTimeout(() => { btn.innerHTML = old; }, 1200);
}

/** Primary export: straight to clipboard. Shift+click previews in the modal. */
async function exportToClipboard(): Promise<void> {
  const text = exportAscii(app.doc.shapes);
  if (!text) {
    flash($('#export'), 'Canvas empty');
    return;
  }
  await copyText(text);
  flash($('#export'), 'Copied ✓');
}

function openExport(): void {
  const text = exportAscii(app.doc.shapes);
  const out = $<HTMLTextAreaElement>('#out');
  out.value = text;
  const lines = text ? text.split('\n') : [];
  const cols = lines.reduce((m, l) => Math.max(m, l.length), 0);
  $('#stats').textContent = text
    ? `${lines.length} lines × ${cols} cols · ${text.length} chars`
    : 'canvas is empty';
  $('#modal').hidden = false;
  out.focus();
  out.select();
}

function closeExport(): void {
  $('#modal').hidden = true;
}

/* ---------- keyboard ---------- */

function onKeyDown(e: KeyboardEvent): void {
  if (app.editing != null) return;
  const t = e.target;
  const modal = $('#modal');
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
    if (e.shiftKey) redo();
    else undo();
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    app.selection = new Set(app.doc.shapes.map((s) => s.id));
    render();
    return;
  }
  if (mod) return;

  switch (e.key) {
    case 'Delete': case 'Backspace':
      e.preventDefault();
      deleteSelected();
      return;
    case 'Escape': {
      const d = app.drag;
      if (d) {
        if (d.mode !== 'marquee') app.doc = JSON.parse(d.snap);
        app.drag = null;
      }
      app.selection = new Set();
      render();
      return;
    }
    case 'Enter': {
      const s = soleSel();
      if (s) {
        e.preventDefault();
        startEdit(s);
      }
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
    case 'e': case 'E':
      if (e.shiftKey) openExport();
      else void exportToClipboard();
      break;
  }
}

export function initUi(): void {
  document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) =>
    b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
  $('#undo').addEventListener('click', () => { undo(); render(); });
  $('#redo').addEventListener('click', () => { redo(); render(); });
  $('#delete').addEventListener('click', deleteSelected);
  $('#clear').addEventListener('click', clearAll);
  $('#export').addEventListener('click', (e) => {
    if ((e as MouseEvent).shiftKey) openExport();
    else void exportToClipboard();
  });
  $('#close').addEventListener('click', closeExport);
  $('#copy').addEventListener('click', async () => {
    await copyText($<HTMLTextAreaElement>('#out').value);
    flash($('#copy'), 'Copied ✓');
  });
  $('#download').addEventListener('click', () => {
    const blob = new Blob([$<HTMLTextAreaElement>('#out').value + '\n'], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const name = app.projects.find((p) => p.id === app.currentProject)?.name || 'diagram';
    a.download = name + '.txt';
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $<HTMLSelectElement>('#project').addEventListener('change', (e) => {
    const sel = e.target as HTMLSelectElement;
    switchProject(sel.value);
    sel.blur();
  });
  $('#proj-new').addEventListener('click', newProject);
  $('#proj-rename').addEventListener('click', renameProject);
  $('#proj-delete').addEventListener('click', deleteProject);
  $('#modal').addEventListener('mousedown', (e) => {
    if (e.target === $('#modal')) closeExport();
  });
  window.addEventListener('keydown', onKeyDown);
  $('#hint').textContent = hintText(0, 0);
}
