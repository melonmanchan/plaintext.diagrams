import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { insideGroup } from '../src/shapes';
import type { ArrowShape, BoxShape, GroupShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const group = (id: number, x: number, y: number, w: number, h: number, text = ''): GroupShape =>
  ({ type: 'group', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

describe('group frames', () => {
  it('renders a titled frame with a tab on top', () => {
    const shapes: Shape[] = [
      group(1, 0, 0, 30, 9, 'Backend'),
      box(2, 3, 4, 9, 3, 'API'),
      box(3, 17, 4, 9, 3, 'DB'),
      arrow(4, { box1: 2, box2: 3 }),
    ];
    expect(exportAscii(shapes)).toBe([
      '+=========+',
      '| Backend |',
      '+=========+==================+',
      '|                            |',
      '|  +-------+     +-------+   |',
      '|  |  API  |---->|  DB   |   |',
      '|  +-------+     +-------+   |',
      '|                            |',
      '+============================+',
    ].join('\n'));
  });

  it('renders an untitled group as a plain frame', () => {
    expect(exportAscii([group(1, 0, 0, 10, 3)])).toBe([
      '+========+',
      '|        |',
      '+========+',
    ].join('\n'));
  });

  it('uses double-line unicode characters with tab junctions', () => {
    const out = exportAscii([group(1, 0, 0, 12, 5, 'G')], true);
    expect(out).toContain('╔═══╗');
    expect(out).toContain('║ G ║');
    expect(out).toContain('╠═══╩══════╗');
    expect(out).toContain('╚══════════╝');
  });

  it('round-trips through the parser with title and contents intact', () => {
    const shapes: Shape[] = [
      group(1, 0, 0, 30, 9, 'Backend'),
      box(2, 3, 4, 9, 3, 'API'),
      box(3, 17, 4, 9, 3, 'DB'),
      arrow(4, { box1: 2, box2: 3 }),
    ];
    const first = exportAscii(shapes);
    const reparsed = parseAscii(first);
    const g = reparsed.find((s): s is GroupShape => s.type === 'group');
    expect(g).toBeDefined();
    expect(g!.text).toBe('Backend');
    expect([g!.x, g!.y, g!.w, g!.h]).toEqual([0, 0, 30, 9]);
    expect(reparsed.filter((s) => s.type === 'box')).toHaveLength(2);
    expect(exportAscii(reparsed)).toBe(first);
  });

  it('insideGroup covers boxes, texts, and free arrows', () => {
    const g = group(1, 0, 0, 30, 10);
    expect(insideGroup(box(2, 5, 3, 6, 3), g)).toBe(true);
    expect(insideGroup(box(3, 25, 3, 10, 3), g)).toBe(false); // sticks out
    expect(insideGroup({ type: 'text', id: 4, x: 2, y: 2, text: 'hi' }, g)).toBe(true);
    expect(insideGroup(arrow(5, { x1: 2, y1: 2, x2: 10, y2: 5 }), g)).toBe(true);
    expect(insideGroup(arrow(6, { x1: 2, y1: 2, x2: 40, y2: 5 }), g)).toBe(false);
  });
});
