# JSON shape import/export — design

Date: 2026-08-17. Status: approved (interactive review).

## Goal

Accept the shapes JSON (the skill's intermediate format) as a paste-import
alternative to plaintext diagrams, and offer the same format on export. This
makes agent-driven ("skill-based") diagram authoring lossless — no grid-parse
ambiguity — and shrinks the skill's bundled `render.mjs` from a
validator/checker to an optional text-preview tool.

## Decisions

- **Import surface:** paste auto-detect only. Clipboard text whose trimmed
  form starts with `{` or `[` is treated as shapes JSON; if it looks like
  JSON but fails validation, the paste errors visibly (hint bar) rather than
  falling through to the text parser. Anything else uses the existing
  plaintext parser. Text diagrams cannot start with `{`/`[`.
- **Export symmetry:** the Shift+E preview modal gains a "Copy JSON" button
  serializing the whole document (selection copy via Cmd+C stays text).
- **Envelope:** accept a bare shape array or `{ "shapes": [...] }` — same as
  the CLI today. Serialization emits a bare array, one shape per line. No
  version field (schema is small and additive; YAGNI).
- **Placement:** identical to text paste — bounding box normalized to the
  mouse-cell anchor; relative coordinates preserved.
- **IDs:** always remapped through `uid()` on paste; arrow box references
  rewritten accordingly.
- **Validation policy:** hard errors (unknown `type`, arrow referencing a
  missing box id, non-object entries) reject the whole paste with the first
  message shown; soft issues (missing sizes, undersized boxes/groups) are
  auto-fixed (`fitBoxToLabel`, group minimums) — same policy as the CLI.
- **Undo:** single `pushUndo`, like text paste.

## Architecture

New `src/interop.ts` owns both directions and becomes the single source of
truth for JSON-side validation/normalization:

- `parseShapesJson(text): { shapes: Shape[]; errors: string[] } | null` —
  `null` = "not JSON, fall through to text parser"; `errors` non-empty =
  looked like JSON but invalid (all-or-nothing).
- `serializeShapes(shapes): string`.

Consumers: `ui.ts` paste handler, "Copy JSON" button, and
`scripts/render-cli.ts` (drops its inline validation, keeps `--check` and
rendering for text-artifact workflows).

Skill `drawing-plaintext-diagrams` is rewritten: primary path = emit JSON and
paste into the app; `render.mjs` only when the deliverable is the text
itself (READMEs, PRs) or offline preview. Skill edit is re-verified with a
fresh subagent run (writing-skills discipline).

## Testing

- Unit (`tests/interop.test.ts`): JSON→shapes→JSON round-trip, envelope
  tolerance, id auto-assign + remap-safety, dangling arrow ref rejection,
  non-JSON returns null, box auto-fit normalization.
- Browser: paste JSON → live shapes at anchor; text paste regression; Copy
  JSON output re-imports equal.
- CLI smoke: existing example diagrams still render + `--check` green.
