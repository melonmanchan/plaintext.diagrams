import { describe, expect, it } from 'vitest';
import { autoLayout, tidy } from '../src/layout';
import type { ArrowShape, BoxShape, GroupShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const group = (id: number, x: number, y: number, w: number, h: number, text = ''): GroupShape =>
  ({ type: 'group', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

const overlaps = (a: BoxShape | GroupShape, b: BoxShape | GroupShape) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

describe('autoLayout', () => {
  it('lays a chain out left-to-right without overlaps', () => {
    const a = box(1, 50, 40, 10, 3, 'A');
    const b = box(2, 5, 5, 10, 3, 'B');
    const c = box(3, 30, 20, 10, 3, 'C');
    const shapes: Shape[] = [a, b, c,
      arrow(4, { box1: 1, box2: 2 }),
      arrow(5, { box1: 2, box2: 3 }),
    ];
    autoLayout(shapes);
    expect(a.x + a.w).toBeLessThan(b.x);
    expect(b.x + b.w).toBeLessThan(c.x);
    expect(overlaps(a, b)).toBe(false);
    expect(overlaps(b, c)).toBe(false);
    // chain members share a rank axis
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
  });

  it('treats a group as a rigid unit and carries its contents', () => {
    const g = group(1, 40, 30, 26, 9, 'Zone');
    const inner = box(2, 44, 34, 8, 3, 'In');
    const outer = box(3, 0, 0, 8, 3, 'Out');
    const shapes: Shape[] = [g, inner, outer, arrow(4, { box1: 3, box2: 2 })];
    const rel = [inner.x - g.x, inner.y - g.y];
    autoLayout(shapes);
    expect([inner.x - g.x, inner.y - g.y]).toEqual(rel); // interior preserved
    expect(outer.x + outer.w).toBeLessThan(g.x);          // edge orders them
    expect(overlaps(g, outer)).toBe(false);
  });

  it('is a no-op with fewer than two nodes', () => {
    const a = box(1, 7, 7, 10, 3);
    autoLayout([a]);
    expect([a.x, a.y]).toEqual([7, 7]);
  });

  it('scopes to a selection and anchors it at its original corner', () => {
    const a = box(1, 20, 10, 10, 3, 'A');
    const b = box(2, 22, 20, 10, 3, 'B');
    const bystander = box(3, 70, 5, 10, 3, 'Z');
    const shapes: Shape[] = [a, b, bystander,
      arrow(4, { box1: 1, box2: 2 }),
      arrow(5, { box1: 1, box2: 3 }),
    ];
    autoLayout(shapes, new Set([1, 2]));
    expect([bystander.x, bystander.y]).toEqual([70, 5]);   // untouched
    expect(a.x + a.w).toBeLessThan(b.x);                    // laid out LR
    expect(Math.min(a.x, b.x)).toBe(20);                    // anchored
    expect(Math.min(a.y, b.y)).toBe(10);
  });

  it('keeps a selection laid out inside its group, growing the frame if needed', () => {
    const g = group(1, 4, 4, 40, 20, 'Zone');
    const a = box(2, 8, 10, 10, 3, 'A');
    const b = box(3, 9, 14, 10, 3, 'B');
    const c = box(4, 10, 18, 10, 3, 'C');
    const shapes: Shape[] = [g, a, b, c,
      arrow(5, { box1: 2, box2: 3 }),
      arrow(6, { box1: 3, box2: 4 }),
    ];
    autoLayout(shapes, new Set([2, 3, 4]));
    for (const s of [a, b, c]) {
      expect(s.x).toBeGreaterThan(g.x);
      expect(s.y).toBeGreaterThan(g.y + 2); // below tab + top border
      expect(s.x + s.w).toBeLessThan(g.x + g.w);
      expect(s.y + s.h).toBeLessThan(g.y + g.h);
    }
  });
});

describe('tidy', () => {
  it('snaps near-aligned boxes into line without touching distant ones', () => {
    const a = box(1, 10, 10, 10, 4);
    const b = box(2, 11, 30, 10, 4);  // left edge 1 off
    const c = box(3, 50, 50, 10, 4);  // far away
    tidy([a, b, c]);
    expect(a.x).toBe(b.x);            // aligned onto one column
    expect([c.x, c.y]).toEqual([50, 50]);
  });
});
