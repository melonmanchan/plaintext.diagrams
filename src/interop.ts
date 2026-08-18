import { MAX_COLS, MAX_ROWS } from './constants';
import { fitBoxToLabel, groupMinSize } from './shapes';
import type { ArrowShape, BoxShape, GroupShape, Shape, TextShape } from './types';
import { clamp } from './util';

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

  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  const ids = new Set<number>();
  let seq = 1;
  for (const s of shapes) {
    if (!s || typeof s !== 'object' || !Object.hasOwn(SHAPE_TYPES, s.type)) {
      errors.push(`unknown shape: ${JSON.stringify(s).slice(0, 80)}`);
      continue;
    }
    if (typeof s.id === 'number') {
      if (ids.has(s.id)) errors.push(`duplicate shape id ${s.id}`);
      ids.add(s.id);
    }
  }
  for (const s of shapes) {
    if (typeof s.id !== 'number') {
      while (ids.has(seq)) seq++;
      s.id = seq;
      ids.add(seq);
    }
  }

  for (const s of shapes) {
    if (!Object.hasOwn(SHAPE_TYPES, s.type)) continue;
    if (s.text != null && typeof s.text !== 'string') {
      errors.push(`${s.type} ${s.id}: "text" must be a string`);
      continue;
    }
    if (s.type === 'arrow') {
      const a = s as ArrowShape;
      if (![a.x1, a.y1, a.x2, a.y2].every((v) => v == null || num(v))) {
        errors.push(`arrow ${a.id}: x1,y1,x2,y2 must be numbers`);
        continue;
      }
      a.x1 = clamp(Math.round(a.x1 ?? 0), 0, MAX_COLS - 1);
      a.x2 = clamp(Math.round(a.x2 ?? 0), 0, MAX_COLS - 1);
      a.y1 = clamp(Math.round(a.y1 ?? 0), 0, MAX_ROWS - 1);
      a.y2 = clamp(Math.round(a.y2 ?? 0), 0, MAX_ROWS - 1);
      a.box1 ??= null; a.box2 ??= null;
      for (const ref of [a.box1, a.box2]) {
        if (ref != null && !shapes.some((sh) => sh.id === ref && sh.type === 'box'))
          errors.push(`arrow ${a.id} references box id ${ref}, which does not exist`);
      }
      if (a.box1 == null && a.box2 == null && a.x1 === a.x2 && a.y1 === a.y2)
        errors.push(`arrow ${a.id} needs box1/box2 ids or distinct x1,y1 → x2,y2 coordinates`);
    } else {
      const p = s as BoxShape | GroupShape | TextShape;
      if (!num(p.x ?? 0) || !num(p.y ?? 0)) {
        errors.push(`${s.type} ${s.id}: "x" and "y" must be numbers`);
        continue;
      }
      p.x = clamp(Math.round(p.x ?? 0), 0, MAX_COLS - 1);
      p.y = clamp(Math.round(p.y ?? 0), 0, MAX_ROWS - 1);
      if (s.type === 'box' || s.type === 'group') {
        const b = s as BoxShape | GroupShape;
        if (!num(b.w ?? 3) || !num(b.h ?? 3)) {
          errors.push(`${s.type} ${b.id}: "w" and "h" must be numbers`);
          continue;
        }
        // Clamp to the world so oversized geometry can't freeze rendering.
        b.w = clamp(Math.round(b.w ?? (s.type === 'box' ? 3 : 4)), 1, MAX_COLS - b.x);
        b.h = clamp(Math.round(b.h ?? 3), 1, MAX_ROWS - b.y);
        if (s.type === 'box') {
          fitBoxToLabel(b); // labels never get cut off
        } else {
          const g = s as GroupShape;
          if (g.lanes != null && !(Array.isArray(g.lanes) && g.lanes.every((l) => typeof l === 'string'))) {
            errors.push(`group ${g.id}: "lanes" must be an array of strings`);
            continue;
          }
          const [minW, minH] = groupMinSize(g);
          g.w = Math.min(Math.max(g.w, minW), MAX_COLS - g.x);
          g.h = Math.min(Math.max(g.h, minH), MAX_ROWS - g.y);
        }
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

/**
 * Rewrite every shape id to a fresh value from `next`, fixing up arrow box
 * refs. Used by both the paste importer and the share-link importer so that
 * untrusted/foreign ids never reach the document (a huge id would otherwise
 * saturate the uid counter and collide every subsequently created shape).
 */
export function remapIds(shapes: Shape[], next: () => number): void {
  const idMap = new Map<number, number>();
  for (const s of shapes) idMap.set(s.id, next());
  for (const s of shapes) {
    s.id = idMap.get(s.id)!;
    if (s.type === 'arrow') {
      s.box1 = s.box1 != null ? idMap.get(s.box1) ?? null : null;
      s.box2 = s.box2 != null ? idMap.get(s.box2) ?? null : null;
    }
  }
}

/* ---------- share links: #s=1.<base64url(deflateRaw(JSON))> ---------- */

const SHARE_VERSION = '1.';
/** Hard cap on decompressed share-link bytes — blocks deflate bombs from a hostile URL. */
const MAX_SHARE_BYTES = 1 << 22;

async function pipeBytes(
  bytes: Uint8Array<ArrayBuffer>,
  stream: CompressionStream | DecompressionStream,
  maxBytes = Infinity,
): Promise<Uint8Array> {
  const reader = new Blob([bytes]).stream().pipeThrough(stream).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) { await reader.cancel(); throw new Error('share link too large'); }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Encode a project as a URL-fragment value: `1.` + base64url(deflate(JSON)). */
export async function encodeShareLink(name: string, shapes: Shape[]): Promise<string> {
  const json = JSON.stringify({ n: name, s: shapes });
  const packed = await pipeBytes(new TextEncoder().encode(json), new CompressionStream('deflate-raw'));
  return SHARE_VERSION + toBase64Url(packed);
}

/** Decode a `#s=` fragment value back into a named shape list. */
export async function decodeShareLink(fragment: string): Promise<{ name: string; shapes: Shape[] } | { error: string }> {
  if (!fragment.startsWith(SHARE_VERSION)) return { error: 'unsupported share-link version' };
  let json: string;
  try {
    const packed = fromBase64Url(fragment.slice(SHARE_VERSION.length));
    json = new TextDecoder().decode(await pipeBytes(packed, new DecompressionStream('deflate-raw'), MAX_SHARE_BYTES));
  } catch {
    return { error: 'share link is corrupt' };
  }
  let payload: unknown;
  try { payload = JSON.parse(json); } catch { return { error: 'share link is corrupt' }; }
  if (!payload || typeof payload !== 'object' || !('s' in payload)) return { error: 'share link is corrupt' };
  const name = 'n' in payload && typeof payload.n === 'string' ? payload.n : 'Shared';
  const parsed = parseShapesJson(JSON.stringify({ shapes: payload.s }));
  if (!parsed || parsed.errors.length) return { error: parsed?.errors[0] ?? 'share link is corrupt' };
  return { name, shapes: parsed.shapes };
}
