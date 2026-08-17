import { describe, expect, it } from 'vitest';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { applyGroupSlots, captureGroupSlots } from '../src/shapes';
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
    expect(out.startsWith('─')).toBe(true);
    expect(out.endsWith('▶')).toBe(true);
    expect(out).toContain(' ─ ');
    expect(out.length).toBe(13);
  });

  it('vertical dashed runs render dotted on every cell', () => {
    const out = exportAscii([arrow(1, { x1: 0, y1: 0, x2: 0, y2: 6, style: 'dashed' })]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(7);
    for (const l of lines.slice(0, 6)) expect(l).toBe('┊');
    expect(lines[6]).toBe('▼');
  });

  it('vertical dotted round-trips with style and attachments', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 10, 3, 'Top'), box(2, 0, 10, 10, 3, 'Bot'),
      arrow(3, { box1: 1, box2: 2, style: 'dashed' }),
    ];
    const first = exportAscii(shapes);
    expect(first).toContain('┊');
    const reparsed = parseAscii(first);
    const a = reparsed.find((s): s is ArrowShape => s.type === 'arrow');
    expect(a?.style).toBe('dashed');
    expect([a?.box1, a?.box2]).toEqual([1, 2]);
    expect(exportAscii(reparsed)).toBe(first);
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
  it('render with rounded unicode corners', () => {
    const b: BoxShape = { ...box(1, 0, 0, 10, 3, 'Go'), style: 'round' };
    expect(exportAscii([b])).toBe([
      '╭────────╮',
      '│   Go   │',
      '╰────────╯',
    ].join('\n'));
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

describe('swimlanes', () => {
  it('render a header band with separators and lane titles', () => {
    const g: GroupShape = { ...group(1, 0, 0, 31, 8), lanes: ['Client', 'API', 'Worker'] };
    expect(exportAscii([g])).toBe([
      '╔═════════╦═════════╦═════════╗',
      '║ Client  ║ API     ║ Worker  ║',
      '╠═════════╬═════════╬═════════╣',
      '║         ║         ║         ║',
      '║         ║         ║         ║',
      '║         ║         ║         ║',
      '║         ║         ║         ║',
      '╚═════════╩═════════╩═════════╝',
    ].join('\n'));
  });

  it('round-trip preserves lanes, titles, and contents', () => {
    const g: GroupShape = { ...group(1, 0, 0, 40, 12, 'Flow'), lanes: ['Client', 'API'] };
    const shapes: Shape[] = [g, box(2, 4, 7, 10, 3, 'In')];
    const first = exportAscii(shapes);
    const reparsed = parseAscii(first);
    const rg = reparsed.find((s): s is GroupShape => s.type === 'group');
    expect(rg?.lanes).toEqual(['Client', 'API']);
    expect(rg?.text).toBe('Flow');
    expect(reparsed.filter((s) => s.type === 'box')).toHaveLength(1);
    expect(exportAscii(reparsed)).toBe(first);
  });

  it('resizing keeps contents in their lanes (slot capture/apply)', () => {
    const g: GroupShape = { ...group(1, 0, 0, 61, 16), lanes: ['A', 'B', 'C'] };
    // lane edges at 0,20,40,60 → lane B interior is 21..39
    const b: BoxShape = box(2, 24, 6, 10, 3, 'In-B');
    const shapes: Shape[] = [g, b];
    const slots = captureGroupSlots(g, shapes);
    expect(slots).toHaveLength(1);
    expect(slots[0].lane).toBe(1);
    // widen the group: lanes move; the box must stay inside lane B
    g.w = 91; // edges now 0,30,60,90 → lane B interior 31..59
    applyGroupSlots(g, shapes, slots);
    expect(b.x).toBeGreaterThan(30);
    expect(b.x + b.w - 1).toBeLessThan(60);
    // shrink hard: lane B interior 11..19 (w=31) — box clamps inside
    g.w = 31;
    applyGroupSlots(g, shapes, slots);
    expect(b.x).toBeGreaterThan(10);
    expect(b.x + b.w - 1).toBeLessThan(21);
  });

  it('resizing a plain group keeps contents inside the frame', () => {
    const g = group(1, 0, 0, 40, 14, 'T'); // tabbed: main frame top at y+2
    const b: BoxShape = box(2, 25, 8, 10, 3, 'In');
    const shapes: Shape[] = [g, b];
    const slots = captureGroupSlots(g, shapes);
    expect(slots).toHaveLength(1);
    // shrink hard: interior is 1..18 wide, rows 3..12
    g.w = 20; g.h = 13;
    applyGroupSlots(g, shapes, slots);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x + b.w - 1).toBeLessThan(19);
    expect(b.y).toBeGreaterThan(2);
    expect(b.y + b.h - 1).toBeLessThan(12);
  });
});

describe('labels containing structural glyphs', () => {
  it('keeps v/-/+ label characters out of the line tracer', () => {
    const shapes: Shape[] = [
      box(1, 0, 0, 16, 3, 'A'), box(2, 0, 10, 16, 3, 'B'), box(3, 0, 22, 16, 4, 'C'),
      arrow(4, { box1: 1, box2: 2, text: 'save' }),
      arrow(5, { box1: 2, box2: 3, text: 'auto-rollback', style: 'dashed' }),
    ];
    const first = exportAscii(shapes);
    const re = parseAscii(first);
    const labels = re.filter((s): s is ArrowShape => s.type === 'arrow').map((a) => a.text).sort();
    expect(labels).toEqual(['auto-rollback', 'save']);
    expect(re.find((s): s is ArrowShape => s.type === 'arrow' && s.text === 'auto-rollback')?.style).toBe('dashed');
    expect(re.filter((s) => s.type === 'text')).toHaveLength(0);
    expect(exportAscii(re)).toBe(first);
  });
});
