import { fitBoxToLabel, groupMinSize } from './shapes';
import type { ArrowShape, BoxShape, GroupShape, Shape, TextShape } from './types';

/* ============================================================
 * Shapes JSON interop — the agent-facing intermediate format.
 * Single source of truth for validation and normalization,
 * shared by the paste importer, the export modal, and the
 * skill's render CLI.
 * ============================================================ */

export interface ParsedShapes {
  shapes: Shape[];
  /** Non-empty = looked like shapes JSON but is invalid (all-or-nothing). */
  errors: string[];
}

const SHAPE_TYPES: Record<string, true> = { box: true, arrow: true, text: true, group: true };

/**
 * Parse shapes JSON: a bare array or `{ "shapes": [...] }`.
 * Returns null when the text does not look like JSON at all — callers
 * fall through to the plaintext parser.
 */
export function parseShapesJson(text: string): ParsedShapes | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    return { shapes: [], errors: ['invalid JSON: ' + String(e)] };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && 'shapes' in parsed && Array.isArray(parsed.shapes)
      ? parsed.shapes
      : null;
  if (!list) return { shapes: [], errors: ['expected a shape array or { "shapes": [...] }'] };

  const errors: string[] = [];
  // Boundary cast: every field is validated/normalized below.
  const shapes = list.map((s) => ({ ...(s as Shape) }));

  const ids = new Set<number>();
  let seq = 1;
  for (const s of shapes) {
    if (!s || typeof s !== 'object' || !SHAPE_TYPES[s.type]) {
      errors.push(`unknown shape: ${JSON.stringify(s).slice(0, 80)}`);
      continue;
    }
    if (typeof s.id === 'number') ids.add(s.id);
  }
  for (const s of shapes) {
    if (typeof s.id !== 'number') {
      while (ids.has(seq)) seq++;
      s.id = seq;
      ids.add(seq);
    }
  }

  for (const s of shapes) {
    if (!SHAPE_TYPES[s.type]) continue;
    if (s.type === 'arrow') {
      const a = s as ArrowShape;
      a.x1 ??= 0; a.y1 ??= 0; a.x2 ??= 0; a.y2 ??= 0;
      a.box1 ??= null; a.box2 ??= null;
      for (const ref of [a.box1, a.box2]) {
        if (ref != null && !shapes.some((sh) => sh.id === ref && sh.type === 'box'))
          errors.push(`arrow ${a.id} references box id ${ref}, which does not exist`);
      }
      if (a.box1 == null && a.box2 == null && a.x1 === a.x2 && a.y1 === a.y2)
        errors.push(`arrow ${a.id} needs box1/box2 ids or distinct x1,y1 → x2,y2 coordinates`);
    } else {
      const p = s as BoxShape | GroupShape | TextShape;
      p.x = Math.round(p.x ?? 0);
      p.y = Math.round(p.y ?? 0);
      if (s.type === 'box') {
        const b = s as BoxShape;
        b.w = Math.round(b.w ?? 3);
        b.h = Math.round(b.h ?? 3);
        fitBoxToLabel(b); // labels never get cut off
      } else if (s.type === 'group') {
        const g = s as GroupShape;
        g.w = Math.round(g.w ?? 4);
        g.h = Math.round(g.h ?? 3);
        const [minW, minH] = groupMinSize(g);
        if (g.w < minW) g.w = minW;
        if (g.h < minH) g.h = minH;
      } else if (typeof (s as TextShape).text !== 'string' || !(s as TextShape).text) {
        errors.push(`text shape ${s.id} needs a non-empty "text"`);
      }
    }
  }

  return { shapes: errors.length ? [] : shapes, errors };
}

/** Serialize shapes as the interop JSON — a bare array, one shape per line. */
export function serializeShapes(shapes: Shape[]): string {
  return '[\n' + shapes.map((s) => '  ' + JSON.stringify(s)).join(',\n') + '\n]';
}
