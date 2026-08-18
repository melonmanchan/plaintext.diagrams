import { describe, expect, it } from 'vitest';
import { decodeShareLink, encodeShareLink, parseShapesJson } from '../src/interop';
import type { Shape } from '../src/types';

const shapes: Shape[] = parseShapesJson(
  '[{"type":"box","id":1,"x":0,"y":0,"w":10,"h":3,"text":"A","style":"round"},' +
  '{"type":"group","id":2,"x":20,"y":0,"w":30,"h":10,"text":"G","lanes":["L","R"]},' +
  '{"type":"arrow","id":3,"x1":0,"y1":0,"x2":0,"y2":0,"box1":1,"box2":null,"text":"go","style":"dashed"}]',
)!.shapes;

describe('share links', () => {
  it('round-trips name and shapes through the fragment', async () => {
    const frag = await encodeShareLink('My Project', shapes);
    const back = await decodeShareLink(frag);
    expect('error' in back).toBe(false);
    if ('error' in back) return;
    expect(back.name).toBe('My Project');
    expect(back.shapes).toEqual(shapes);
  });

  it('emits only URL-safe fragment characters with a version prefix', async () => {
    const frag = await encodeShareLink('N', shapes);
    expect(frag.startsWith('1.')).toBe(true);
    expect(frag).toMatch(/^[A-Za-z0-9_.-]+$/);
  });

  it('rejects unknown versions cleanly', async () => {
    const back = await decodeShareLink('9.abcdef');
    expect('error' in back && back.error).toContain('version');
  });

  it('rejects garbage payloads cleanly', async () => {
    const back = await decodeShareLink('1.not-really-deflate');
    expect('error' in back).toBe(true);
  });

  it('validates decoded shapes through the JSON gate', async () => {
    // dangling arrow ref must be rejected, not imported
    const bad: Shape[] = [{ type: 'arrow', id: 1, x1: 0, y1: 0, x2: 5, y2: 0, box1: 99, box2: null }];
    const frag = await encodeShareLink('X', bad);
    const back = await decodeShareLink(frag);
    expect('error' in back && back.error).toContain('99');
  });
});
