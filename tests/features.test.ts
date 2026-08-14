import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { snapBox } from '../src/shapes';
import type { ArrowShape, BoxShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

describe('arrow head states', () => {
  it('renders heads on both ends', () => {
    expect(exportAscii([arrow(1, { x1: 0, y1: 0, x2: 8, y2: 0, heads: 'both' })]))
      .toBe('<------->');
  });

  it('renders a start-only head', () => {
    expect(exportAscii([arrow(1, { x1: 0, y1: 0, x2: 8, y2: 0, heads: 'start' })]))
      .toBe('<--------');
  });


  it('parses back as a single dual arrow', () => {
    const shapes = parseAscii('<------->');
    const as = shapes.filter((s): s is ArrowShape => s.type === 'arrow');
    expect(as).toHaveLength(1);
    expect(as[0].heads).toBe('both');
    expect(shapes).toHaveLength(1); // no stray text from the second head
  });

  it('round-trips dual arrows between boxes', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 6, 3), box(2, 16, 0, 6, 3),
      arrow(3, { box1: 1, box2: 2, heads: 'both' }),
    ];
    const first = exportAscii(shapes);
    expect(first).toContain('<');
    expect(first).toContain('>');
    expect(exportAscii(parseAscii(first))).toBe(first);
  });
});

describe('growing world', () => {
  it('exports content far beyond the initial 200x100 world', () => {
    const shapes: Shape[] = [
      box(1, 400, 200, 10, 3, 'Far'),
      box(2, 430, 200, 10, 3, 'Away'),
      arrow(3, { box1: 1, box2: 2 }),
    ];
    const out = exportAscii(shapes);
    expect(out).toContain('Far');
    expect(out).toContain('Away');
    expect(out).toContain('>');
  });
});

describe('parallel arrows between the same boxes', () => {
  it('spread onto distinct rows instead of overlapping', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 6, 7),
      box(2, 20, 0, 6, 7),
      arrow(3, { box1: 1, box2: 2 }),
      arrow(4, { box1: 1, box2: 2 }),
      arrow(5, { box1: 2, box2: 1 }),
    ];
    const out = exportAscii(shapes);
    const arrowRows = out.split('\n').filter((l) => l.includes('>') || l.includes('<'));
    expect(arrowRows).toHaveLength(3);
    expect(out.match(/>/g)).toHaveLength(2);
    expect(out.match(/</g)).toHaveLength(1);
  });

  it('overflows to top/bottom sides when the facing side is full', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 12, 8, 'Client'),
      box(2, 48, 2, 21, 3, 'Server'),
      arrow(3, { box1: 1, box2: 2 }),
      arrow(4, { box1: 1, box2: 2, text: 'http POST' }),
      arrow(5, { box1: 1, box2: 2, text: 'HTTP patch' }),
    ];
    expect(exportAscii(shapes)).toBe([
      '+----------+',
      '|          |-------------- http POST -------------v',
      '|          |                                    +-------------------+',
      '|  Client  |----------------------------------->|      Server       |',
      '|          |                                    +-------------------+',
      '|          |------------- HTTP patch -------------^',
      '|          |',
      '+----------+',
    ].join('\n'));
  });
});

describe('unicode style', () => {
  it('exports box-drawing characters with proper corners and junctions', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 6, 3, 'ab'),
      arrow(2, { x1: 0, y1: 5, x2: 10, y2: 5 }),
      arrow(3, { x1: 8, y1: 2, x2: 8, y2: 8 }),
    ];
    const out = exportAscii(shapes, true);
    expect(out).toContain('┌────┐');
    expect(out).toContain('└────┘');
    expect(out).toContain('│ ab │');
    expect(out).toContain('┼'); // crossing lines
    expect(out).toContain('▶');
    expect(out).toContain('▼');
  });

  it('unicode output parses back to the same diagram', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 10, 4, 'Node'),
      box(2, 20, 0, 10, 4, 'Peer'),
      arrow(3, { box1: 1, box2: 2 }),
    ];
    const uni = exportAscii(shapes, true);
    const reparsed = parseAscii(uni);
    expect(exportAscii(reparsed, true)).toBe(uni);
  });
});

describe('snapBox', () => {
  it('snaps to center alignment within one cell and reports a guide', () => {
    const anchor = box(1, 10, 10, 10, 10);  // center row 13 for h=4 movers
    const moving = box(2, 40, 14, 8, 4);    // 1 off center; top/bottom further away
    const guides = snapBox(moving, [anchor, moving]);
    expect(moving.y).toBe(13);
    expect(guides.some((g) => g.axis === 'h')).toBe(true);
  });

  it('snaps to edge alignment', () => {
    const anchor = box(1, 10, 10, 10, 6);
    const moving = box(2, 11, 30, 10, 4);   // same width, left edge 1 off
    snapBox(moving, [anchor, moving]);
    expect(moving.x).toBe(10);
  });

  it('does not snap beyond the threshold', () => {
    const anchor = box(1, 10, 10, 10, 6);
    const moving = box(2, 14, 30, 8, 4);
    const guides = snapBox(moving, [anchor, moving]);
    expect(moving.x).toBe(14);
    expect(guides.filter((g) => g.axis === 'v')).toHaveLength(0);
  });
});
