/**
 * Text renderer for plaintext.diagrams shape JSON.
 * Bundled into the agent skill for when the deliverable is the text itself
 * (READMEs, PRs) or an offline preview. For app-bound diagrams, paste the
 * JSON straight into the editor instead — it imports losslessly.
 *
 *   bun render.mjs shapes.json          → Unicode diagram on stdout
 *   cat shapes.json | bun render.mjs    → same, from stdin
 *   bun render.mjs --check shapes.json  → also re-parse the output and
 *                                         verify it round-trips; exit 1 on loss
 */
import { readFileSync } from 'node:fs';
import { exportAscii } from '../src/export';
import { parseAscii } from '../src/import';
import { parseShapesJson } from '../src/interop';
import type { ArrowShape, Shape } from '../src/types';

function fail(msg: string): never {
  process.stderr.write('error: ' + msg + '\n');
  process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes('--check');
const file = args.find((a) => a !== '--check');
const raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');

const parsed = parseShapesJson(raw);
if (!parsed) fail('input does not look like JSON — expected a shape array or { "shapes": [...] }');
if (parsed.errors.length) fail(parsed.errors.join('\n'));
const shapes = parsed.shapes;

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
