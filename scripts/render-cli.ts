/**
 * Text renderer for plaintext.diagrams shape JSON.
 * Bundled into the agent skill for when the deliverable is the text itself
 * (READMEs, PRs) or an offline preview. For app-bound diagrams, paste the
 * JSON straight into the editor instead — it imports losslessly.
 *
 *   bun render.mjs shapes.json          → Unicode diagram on stdout
 *   cat shapes.json | bun render.mjs    → same, from stdin
 *   bun render.mjs --check shapes.json  → also confirm JSON validity on stderr
 *
 * Invalid JSON (schema, ids, arrow references) always fails with exit 1.
 */
import { readFileSync } from "node:fs";
import { exportAscii } from "../src/export";
import { parseShapesJson } from "../src/interop";

function fail(msg: string): never {
	process.stderr.write("error: " + msg + "\n");
	process.exit(1);
}

const args = process.argv.slice(2);
const check = args.includes("--check");
const file = args.find((a) => a !== "--check");
const raw = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");

const parsed = parseShapesJson(raw);
if (!parsed)
	fail(
		'input does not look like JSON — expected a shape array or { "shapes": [...] }',
	);
if (parsed.errors.length) fail(parsed.errors.join("\n"));
const shapes = parsed.shapes;

const out = exportAscii(shapes);
if (!out) fail("diagram rendered empty — no shapes with geometry");

// --check: JSON validity only (schema, ids, arrow references) — reaching
// this point means validation passed. Rendering quality is not gated;
// layout is adjusted in the editor, not by re-rolling geometry here.
if (check) process.stderr.write(`JSON OK — ${shapes.length} shape(s)\n`);

process.stdout.write(out + "\n");
