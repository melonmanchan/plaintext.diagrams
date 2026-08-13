import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import type { ArrowShape, BoxShape, Shape, TextShape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

describe('parseAscii', () => {
  it('parses a labelled box', () => {
    const shapes = parseAscii(['+--------+', '|  Node  |', '+--------+'].join('\n'));
    expect(shapes).toHaveLength(1);
    const b = shapes[0] as BoxShape;
    expect(b.type).toBe('box');
    expect([b.x, b.y, b.w, b.h]).toEqual([0, 0, 10, 3]);
    expect(b.text).toBe('Node');
  });

  it('parses an arrow between boxes and attaches both ends', () => {
    const src = [
      '+---+       +---+',
      '|   |------>|   |',
      '+---+       +---+',
    ].join('\n');
    const shapes = parseAscii(src);
    const bs = shapes.filter((s): s is BoxShape => s.type === 'box');
    const as = shapes.filter((s): s is ArrowShape => s.type === 'arrow');
    expect(bs).toHaveLength(2);
    expect(as).toHaveLength(1);
    expect(as[0].box1).toBe(bs[0].id);
    expect(as[0].box2).toBe(bs[1].id);
  });

  it('recovers embedded arrow labels', () => {
    const shapes = parseAscii('--- go --->');
    const as = shapes.filter((s): s is ArrowShape => s.type === 'arrow');
    expect(as).toHaveLength(1);
    expect(as[0].text).toBe('go');
    expect(shapes.filter((s) => s.type === 'text')).toHaveLength(0);
  });

  it('parses free text runs', () => {
    const shapes = parseAscii('hello world   second run');
    const ts = shapes.filter((s): s is TextShape => s.type === 'text');
    expect(ts.map((t) => t.text)).toEqual(['hello world', 'second run']);
  });

  it('round-trips an exported diagram to identical ASCII', () => {
    const orig: Shape[] = [
      box(1, 0, 0, 12, 5, 'Client'),
      box(2, 30, 2, 14, 7, 'API\nServer'),
      box(3, 31, 16, 12, 3, 'DB'),
      arrow(4, { box1: 1, box2: 2, text: 'req' }),
      arrow(5, { box1: 2, box2: 3 }),
      arrow(6, { x1: 2, y1: 12, x2: 20, y2: 12, text: 'free' }),
      { type: 'text', id: 7, x: 0, y: 20, text: 'a note' },
    ];
    const first = exportAscii(orig);
    const reparsed = parseAscii(first);
    expect(exportAscii(reparsed)).toBe(first);
  });
});
