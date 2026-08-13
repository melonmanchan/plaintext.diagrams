import { describe, expect, it } from 'vitest';
import { boxAttachAt, boxMinSize, fitBoxToLabel, placeFrom } from '../src/shapes';
import type { ArrowShape, BoxShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

describe('boxMinSize / fitBoxToLabel', () => {
  it('computes minimum size from the label', () => {
    expect(boxMinSize(box(1, 0, 0, 3, 3, 'hello\nhi'))).toEqual([7, 4]);
    expect(boxMinSize(box(1, 0, 0, 3, 3))).toEqual([3, 3]);
  });

  it('grows an undersized box but never shrinks', () => {
    const s = box(1, 0, 0, 3, 3, 'longlabel');
    fitBoxToLabel(s);
    expect(s.w).toBe(11);
    expect(s.h).toBe(3);
    const roomy = box(2, 0, 0, 20, 9, 'x');
    fitBoxToLabel(roomy);
    expect([roomy.w, roomy.h]).toEqual([20, 9]);
  });
});

describe('boxAttachAt', () => {
  const shapes: Shape[] = [box(1, 5, 5, 4, 3)];

  it('hits inside and within the 1-cell halo', () => {
    expect(boxAttachAt(shapes, 6, 6)?.id).toBe(1);
    expect(boxAttachAt(shapes, 4, 5)?.id).toBe(1);  // one cell left of border
    expect(boxAttachAt(shapes, 9, 8)?.id).toBe(1);  // one cell past the far corner
  });

  it('misses beyond the halo', () => {
    expect(boxAttachAt(shapes, 3, 5)).toBeNull();
    expect(boxAttachAt(shapes, 6, 10)).toBeNull();
  });
});

describe('placeFrom', () => {
  it('moving an arrow connects a free endpoint that lands on a box', () => {
    const b = box(1, 10, 0, 5, 3);
    const a: ArrowShape = { type: 'arrow', id: 2, x1: 0, y1: 1, x2: 5, y2: 1, box1: null, box2: null };
    const shapes: Shape[] = [b, a];
    const orig = structuredClone(a);
    placeFrom(a, orig, 5, 0, shapes); // drag right: endpoint 2 lands at x=10 inside the box
    expect(a.box2).toBe(1);
    expect(a.box1).toBeNull();
  });

  it('attached endpoints stay put while free ones translate', () => {
    const b = box(1, 10, 0, 5, 3);
    const a: ArrowShape = { type: 'arrow', id: 2, x1: 0, y1: 1, x2: 9, y2: 1, box1: null, box2: 1 };
    const shapes: Shape[] = [b, a];
    const orig = structuredClone(a);
    placeFrom(a, orig, 0, 4, shapes);
    expect(a.y1).toBe(5);      // free endpoint moved
    expect(a.x2).toBe(9);      // attached endpoint untouched
    expect(a.box2).toBe(1);
  });
});
