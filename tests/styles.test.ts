import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import type { ArrowShape, BoxShape, GroupShape, Shape } from '../src/types';

const box = (id: number, x: number, y: number, w: number, h: number, text = ''): BoxShape =>
  ({ type: 'box', id, x, y, w, h, text });

const group = (id: number, x: number, y: number, w: number, h: number, text = ''): GroupShape =>
  ({ type: 'group', id, x, y, w, h, text });

const arrow = (id: number, over: Partial<ArrowShape>): ArrowShape =>
  ({ type: 'arrow', id, x1: 0, y1: 0, x2: 0, y2: 0, box1: null, box2: null, ...over });

describe('dashed arrows', () => {
  it('render with parity gaps, head and tail intact', () => {
    const out = exportAscii([arrow(1, { x1: 0, y1: 0, x2: 12, y2: 0, style: 'dashed' })]);
    expect(out.startsWith('-')).toBe(true);
    expect(out.endsWith('>')).toBe(true);
    expect(out).toContain(' - ');
    expect(out.length).toBe(13);
  });

  it('round-trip: parse detects dashed and re-renders identically', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 8, 3), box(2, 24, 0, 8, 3),
      arrow(3, { box1: 1, box2: 2, style: 'dashed' }),
    ];
    const first = exportAscii(shapes);
    const reparsed = parseAscii(first);
    const a = reparsed.find((s): s is ArrowShape => s.type === 'arrow');
    expect(a?.style).toBe('dashed');
    expect(exportAscii(reparsed)).toBe(first);
  });

  it('solid arrows are not misdetected as dashed', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 8, 3), box(2, 24, 0, 8, 3),
      arrow(3, { box1: 1, box2: 2, text: 'hi' }),
    ];
    const reparsed = parseAscii(exportAscii(shapes));
    const a = reparsed.find((s): s is ArrowShape => s.type === 'arrow');
    expect(a?.style).toBeUndefined();
  });
});

describe('rounded boxes', () => {
  it("render with . and ' corners in ASCII and rounded unicode", () => {
    const b: BoxShape = { ...box(1, 0, 0, 10, 3, 'Go'), style: 'round' };
    expect(exportAscii([b])).toBe([
      '.--------.',
      '|   Go   |',
      "'--------'",
    ].join('\n'));
    const uni = exportAscii([b], true);
    expect(uni).toContain('╭────────╮');
    expect(uni).toContain('╰────────╯');
  });

  it('round-trip preserves the style and attachments', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 10, 3, 'A', ), box(2, 20, 0, 10, 3, 'B'),
      arrow(3, { box1: 1, box2: 2 }),
    ];
    (shapes[0] as BoxShape).style = 'round';
    const first = exportAscii(shapes);
    const reparsed = parseAscii(first);
    const boxes = reparsed.filter((s): s is BoxShape => s.type === 'box');
    expect(boxes.find((b) => b.text === 'A')?.style).toBe('round');
    expect(boxes.find((b) => b.text === 'B')?.style).toBeUndefined();
    expect(exportAscii(reparsed)).toBe(first);
  });
});

describe('dashed groups', () => {
  it('render with gapped borders, corners intact', () => {
    const out = exportAscii([group(1, 0, 0, 12, 4, '', )]);
    expect(out.startsWith('+')).toBe(true);
    const dashed = exportAscii([{ ...group(1, 0, 0, 12, 4), style: 'dashed' }]);
    expect(dashed).toContain(' = ');
    expect(dashed.startsWith('+')).toBe(true);
  });

  it('round-trip preserves dashed style, title, and contents', () => {
    const shapes: Shape[] = [
      { ...group(1, 0, 0, 30, 9, 'Trust'), style: 'dashed' },
      box(2, 4, 4, 10, 3, 'In'),
    ];
    const first = exportAscii(shapes);
    const reparsed = parseAscii(first);
    const g = reparsed.find((s): s is GroupShape => s.type === 'group');
    expect(g?.style).toBe('dashed');
    expect(g?.text).toBe('Trust');
    expect(reparsed.filter((s) => s.type === 'box')).toHaveLength(1);
    expect(exportAscii(reparsed)).toBe(first);
  });
});
