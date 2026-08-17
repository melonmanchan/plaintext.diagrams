/**
 * Standalone renderer for plaintext.diagrams shape JSON.
 * Bundled into the agent skill so diagrams can be produced anywhere:
 *   bun render.mjs shapes.json          → Unicode diagram on stdout
 *   cat shapes.json | bun render.mjs    → same, from stdin
 *   bun render.mjs --check shapes.json  → also re-parse the output and
 *                                         verify it round-trips; exit 1 on loss
 */
import { readFileSync } from 'node:fs';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { fitBoxToLabel } from '../src/shapes';
import type { ArrowShape, BoxShape, GroupShape, Shape } from '../src/types';

function fail(msg: string): never {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const file = args.find((a) => a !== '--check');
const raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');

let parsed: unknown;
try { parsed = JSON.parse(raw); } catch (e) { fail('input is not valid JSON: ' + String(e)); }
const list = Array.isArray(parsed)
  ? parsed
  : parsed && typeof parsed === 'object' && 'shapes' in parsed
    ? parsed.shapes
    : null;
if (!Array.isArray(list)) fail('expected a JSON array of shapes, or { "shapes": [...] }');

// Validate + normalize.
// The boundary cast: shapes are validated field-by-field below.
const shapes = list as Shape[];
let seq = 1;
const ids = new Set<number>();
for (const s of shapes) {
  if (!s || typeof s !== 'object') fail('shape is not an object: ' + JSON.stringify(s));
  if (!['box', 'arrow', 'text', 'group'].includes(s.type)) fail(`unknown shape type "${String(s.type)}"`);
  if (s.id == null) s.id = -1; // assign below, after collecting explicit ids
  else ids.add(s.id);
}
for (const s of shapes) {
  if (s.id === -1) { while (ids.has(seq)) seq++; s.id = seq; ids.add(seq); }
}
for (const s of shapes) {
  if (s.type === 'arrow') {
    const a = s as ArrowShape;
    a.x1 ??= 0; a.y1 ??= 0; a.x2 ??= 0; a.y2 ??= 0;
    a.box1 ??= null; a.box2 ??= null;
    for (const ref of [a.box1, a.box2]) {
      if (ref != null && !shapes.some((sh) => sh.id === ref && sh.type === 'box'))
        fail(`arrow ${a.id} references box id ${ref}, which does not exist`);
    }
    if (a.box1 == null && a.box2 == null && a.x1 === a.x2 && a.y1 === a.y2)
      fail(`arrow ${a.id} needs box1/box2 ids or distinct x1,y1 → x2,y2 coordinates`);
  } else if (s.type === 'box') {
    const b = s as BoxShape;
    b.w ??= 3; b.h ??= 3;
    fitBoxToLabel(b); // labels never get cut off
  } else if (s.type === 'group') {
    const g = s as GroupShape;
    const [minW, minH] = [Math.max(4, (g.text ?? '').length + 4), g.text ? 5 : 3];
    if ((g.w ?? 0) < minW) g.w = minW;
    if ((g.h ?? 0) < minH) g.h = minH;
  }
}

const out = exportAscii(shapes);
if (!out) fail('diagram rendered empty — no shapes with geometry');

if (check) {
  const re = parseAscii(out);
  const count = (ss: Shape[], t: string) => ss.filter((x) => x.type === t).length;
  const labels = (ss: Shape[]) =>
    ss.filter((x): x is ArrowShape => x.type === 'arrow').map((a) => a.text ?? null).filter(Boolean).sort();
  const problems: string[] = [];
  for (const t of ['box', 'group', 'arrow'])
    if (count(shapes, t) !== count(re, t))
      problems.push(`${t} count: drew ${count(shapes, t)}, re-imported ${count(re, t)}`);
  const l1 = labels(shapes), l2 = labels(re);
  if (JSON.stringify(l1) !== JSON.stringify(l2))
    problems.push(`arrow labels: drew ${JSON.stringify(l1)}, re-imported ${JSON.stringify(l2)}`);
  if (count(re, 'text') > count(shapes, 'text'))
    problems.push(`${count(re, 'text') - count(shapes, 'text')} stray text fragment(s) — geometry collision likely`);
  if (problems.length) {
    process.stderr.write('round-trip check FAILED:\n  ' + problems.join('\n  ') + '\n');
    process.stderr.write('hint: shapes probably overlap — spread boxes further apart.\n');
    process.stdout.write(out + '\n');
    process.exit(1);
  }
  process.stderr.write('round-trip check OK\n');
}

process.stdout.write(out + '\n');
