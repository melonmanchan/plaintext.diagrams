import { describe, expect, it } from 'vitest';
import { parseShapesJson, serializeShapes } from '../src/interop';
import type { ArrowShape, BoxShape } from '../src/types';

describe('shapes JSON interop', () => {
  it('returns null for non-JSON so callers fall through to the text parser', () => {
    expect(parseShapesJson('┌───┐\n│ A │\n└───┘')).toBeNull();
    expect(parseShapesJson('hello world')).toBeNull();
  });

  it('accepts a bare array and an object envelope identically', () => {
    const body = '{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3,"text":"A"}';
    const a = parseShapesJson(`[${body}]`);
    const b = parseShapesJson(`{"shapes":[${body}]}`);
    expect(a?.errors).toEqual([]);
    expect(b?.shapes).toEqual(a?.shapes);
  });

  it('reports invalid JSON loudly instead of returning null', () => {
    const r = parseShapesJson('[{"type":"box",]');
    expect(r).not.toBeNull();
    expect(r!.errors[0]).toContain('invalid JSON');
  });

  it('rejects dangling arrow references all-or-nothing', () => {
    const r = parseShapesJson('[{"type":"box","id":1,"x":0,"y":0,"w":8,"h":3},{"type":"arrow","box1":1,"box2":99}]');
    expect(r!.errors[0]).toContain('box id 99');
    expect(r!.shapes).toEqual([]);
  });

  it('auto-assigns missing ids without colliding with explicit ones', () => {
    const r = parseShapesJson('[{"type":"box","x":0,"y":0,"w":8,"h":3},{"type":"box","id":1,"x":20,"y":0,"w":8,"h":3}]');
    const ids = r!.shapes.map((s) => s.id);
    expect(new Set(ids).size).toBe(2);
  });

  it('auto-fits undersized boxes to their labels', () => {
    const r = parseShapesJson('[{"type":"box","id":1,"x":0,"y":0,"w":3,"h":3,"text":"a very long label"}]');
    const b = r!.shapes[0] as BoxShape;
    expect(b.w).toBeGreaterThanOrEqual('a very long label'.length + 4);
  });

  it('serialization round-trips through the parser', () => {
    const src = parseShapesJson(
      '[{"type":"box","id":1,"x":0,"y":0,"w":10,"h":3,"text":"A","style":"round"},' +
      '{"type":"group","id":2,"x":20,"y":0,"w":30,"h":10,"text":"G","lanes":["L","R"]},' +
      '{"type":"arrow","id":3,"x1":0,"y1":0,"x2":0,"y2":0,"box1":1,"box2":null,"text":"go","style":"dashed"}]',
    )!.shapes;
    const re = parseShapesJson(serializeShapes(src));
    expect(re!.errors).toEqual([]);
    expect(re!.shapes).toEqual(src);
    const a = re!.shapes.find((s): s is ArrowShape => s.type === 'arrow');
    expect(a?.style).toBe('dashed');
  });
});
