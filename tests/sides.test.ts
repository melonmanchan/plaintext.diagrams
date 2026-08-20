import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { parseShapesJson } from '../src/interop';
import { resolveArrow } from '../src/raster';
import { dropSide } from '../src/shapes';
import type { ArrowShape, BoxShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

describe('arrow side pins', () => {
  it('router honors pinned sides instead of the facing side', () => {
    // B is to the RIGHT of A; auto would anchor A:right / B:left.
    const a = box(1, 0, 0, 10, 5, 'A');
    const b = box(2, 30, 0, 10, 5, 'B');
    const ar = arrow(3, { box1: 1, box2: 2, side1: 'bottom', side2: 'top' });
    const shapes: Shape[] = [a, b, ar];
    resolveArrow(ar, shapes);
    expect(ar.y1).toBe(a.y + a.h);      // exits below A
    expect(ar.y2).toBe(b.y - 1);        // enters above B
  });

  it('pins are soft: crowded pinned sides still spread onto slots', () => {
    const a = box(1, 0, 0, 12, 7, 'A');
    const b = box(2, 30, 0, 12, 7, 'B');
    const a1 = arrow(3, { box1: 1, box2: 2, side1: 'right', side2: 'left' });
    const a2 = arrow(4, { box1: 1, box2: 2, side1: 'right', side2: 'left' });
    const shapes: Shape[] = [a, b, a1, a2];
    resolveArrow(a1, shapes);
    resolveArrow(a2, shapes);
    expect(a1.x1).toBe(a.x + a.w);
    expect(a2.x1).toBe(a.x + a.w);
    expect(a1.y1).not.toBe(a2.y1);      // distinct slots on the same side
  });

  it('dropSide maps border cells and rejects interior/corners', () => {
    const b = box(1, 10, 10, 10, 5);
    expect(dropSide(b, 9, 12)).toBe('left');
    expect(dropSide(b, 20, 12)).toBe('right');
    expect(dropSide(b, 14, 9)).toBe('top');
    expect(dropSide(b, 14, 15)).toBe('bottom');
    expect(dropSide(b, 14, 12)).toBeUndefined();   // interior
    expect(dropSide(b, 9, 9)).toBeUndefined();     // diagonal corner zone
  });

  it('import infers a pin when the drawn side is not the auto side', () => {
    const a = box(1, 0, 0, 12, 5, 'A');
    const b = box(2, 30, 0, 12, 5, 'B');
    const pinned = arrow(3, { box1: 1, box2: 2, side1: 'bottom' });
    const first = exportAscii([a, b, pinned]);
    const re = parseAscii(first);
    const ra = re.find((s): s is ArrowShape => s.type === 'arrow');
    expect(ra?.side1).toBe('bottom');
    expect(ra?.side2).toBeUndefined();  // auto side stays unpinned
    expect(exportAscii(re)).toBe(first);
  });

  it('auto-routed diagrams import without any pins', () => {
    const shapes: Shape[] = [box(1, 0, 0, 10, 3, 'A'), box(2, 24, 0, 10, 3, 'B'), arrow(3, { box1: 1, box2: 2 })];
    const re = parseAscii(exportAscii(shapes));
    const ra = re.find((s): s is ArrowShape => s.type === 'arrow');
    expect(ra?.side1).toBeUndefined();
    expect(ra?.side2).toBeUndefined();
  });

  it('interop accepts valid side pins and rejects junk', () => {
    const ok = parseShapesJson('[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"box","id":2,"x":20,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":2,"side1":"top"}]');
    expect(ok!.errors).toEqual([]);
    const bad = parseShapesJson('[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"side2":"diagonal","x2":30,"y2":9}]');
    expect(bad!.errors[0]).toContain('side2');
  });
});
