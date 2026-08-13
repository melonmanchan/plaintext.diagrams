import { CH, COLS, CW, ROWS } from './constants';
import type { BoxShape, Corner, Shape } from './types';
import { clamp } from './util';

/* ============================================================
 * Shape geometry: hit zones, attachment, movement, sizing.
 * Pure over a shapes array — no app state.
 * ============================================================ */

export function boxAt(shapes: Shape[], cx: number, cy: number): BoxShape | null {
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'box' &&
        cx >= s.x && cx < s.x + s.w && cy >= s.y && cy < s.y + s.h) return s;
  }
  return null;
}

/** Attachment target: exact hit wins, else any box within 1 cell. */
export function boxAttachAt(shapes: Shape[], cx: number, cy: number): BoxShape | null {
  const exact = boxAt(shapes, cx, cy);
  if (exact) return exact;
  for (let i = shapes.length - 1; i >= 0; i--) {
    const s = shapes[i];
    if (s.type === 'box' &&
        cx >= s.x - 1 && cx < s.x + s.w + 1 && cy >= s.y - 1 && cy < s.y + s.h + 1) return s;
  }
  return null;
}

/** Perimeter cell of a box — the arrow-start zone when the box is selected. */
export function onBoxBorder(s: BoxShape, cx: number, cy: number): boolean {
  if (cx < s.x || cx >= s.x + s.w || cy < s.y || cy >= s.y + s.h) return false;
  return cx === s.x || cx === s.x + s.w - 1 || cy === s.y || cy === s.y + s.h - 1;
}

/** Resize-handle positions in px, at the box's outer corners. */
export function boxHandles(s: BoxShape): { c: Corner; px: number; py: number }[] {
  return [
    { c: 'nw', px: s.x * CW, py: s.y * CH },
    { c: 'ne', px: (s.x + s.w) * CW, py: s.y * CH },
    { c: 'sw', px: s.x * CW, py: (s.y + s.h) * CH },
    { c: 'se', px: (s.x + s.w) * CW, py: (s.y + s.h) * CH },
  ];
}

/**
 * Reposition `s` at `o`'s coordinates shifted by (dx, dy).
 * Arrow endpoints that are free in `o` follow the drag and connect
 * to any box they land on; attached endpoints stay attached.
 */
export function placeFrom(s: Shape, o: Shape, dx: number, dy: number, shapes: Shape[]): void {
  if (s.type === 'box' && o.type === 'box') {
    s.x = clamp(o.x + dx, 0, COLS - s.w);
    s.y = clamp(o.y + dy, 0, ROWS - s.h);
  } else if (s.type === 'text' && o.type === 'text') {
    s.x = clamp(o.x + dx, 0, COLS - 1);
    s.y = clamp(o.y + dy, 0, ROWS - 1);
  } else if (s.type === 'arrow' && o.type === 'arrow') {
    if (!o.box1) {
      s.x1 = clamp(o.x1 + dx, 0, COLS - 1);
      s.y1 = clamp(o.y1 + dy, 0, ROWS - 1);
      const b = boxAttachAt(shapes, s.x1, s.y1);
      s.box1 = b && b.id !== s.box2 ? b.id : null;
    }
    if (!o.box2) {
      s.x2 = clamp(o.x2 + dx, 0, COLS - 1);
      s.y2 = clamp(o.y2 + dy, 0, ROWS - 1);
      const b = boxAttachAt(shapes, s.x2, s.y2);
      s.box2 = b && b.id !== s.box1 ? b.id : null;
    }
  }
}

/** Smallest box that shows its whole label (never below 3×3). */
export function boxMinSize(s: BoxShape): [number, number] {
  if (!s.text) return [3, 3];
  // Borders (2) plus breathing room between label and border.
  const padX = 2;
  const lines = s.text.split('\n');
  return [
    Math.max(3, Math.max(...lines.map((l) => l.length)) + 2 + padX * 2),
    Math.max(3, lines.length + 2),
  ];
}

export function fitBoxToLabel(s: BoxShape): void {
  const [minW, minH] = boxMinSize(s);
  if (s.w < minW) s.w = Math.min(minW, COLS - s.x);
  if (s.h < minH) s.h = Math.min(minH, ROWS - s.y);
}
