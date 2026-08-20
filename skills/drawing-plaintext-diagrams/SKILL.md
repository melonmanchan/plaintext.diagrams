---
name: drawing-plaintext-diagrams
description: Use when creating or editing box-and-arrow diagrams as text — architecture sketches, flow diagrams, or anything destined for the plaintext.diagrams editor (paste-import), a README, or a code comment. Also use when a hand-drawn ASCII/Unicode diagram fails to import or its labels/groups get lost.
---

# Drawing plaintext.diagrams

## Overview

plaintext.diagrams (https://melonmanchan.github.io/plaintext.diagrams/) is a diagram editor whose file format IS the rendered Unicode text. It ALSO paste-imports **shapes JSON** directly — lossless, no grid geometry to get right. Describe shapes as JSON; never hand-draw the character grid.

## What to deliver

**Default: deliver the shapes JSON itself.** The editor detects JSON on paste (clipboard starting with `[` or `{`), validates it, and imports losslessly — invalid JSON shows the first error in the hint bar. No tooling, no rendering step.

**Render to text ONLY when the deliverable is the text itself** — a README, PR description, or code comment read outside the app — or when the user explicitly asks to see the rendered diagram:

```bash
node render.mjs shapes.json > diagram.txt   # render.mjs sits next to this file; bun works too
```

The renderer validates the JSON (schema, ids, arrow references) and fails with a message when it's invalid — fix the JSON error and re-run. **Render ONCE**: do not iterate on coordinates to polish the drawing; layout is adjusted in the editor, not by re-rolling geometry. The rendered text is also paste-importable.

## Shape schema

A JSON array (or `{"shapes": [...]}`). Coordinates are character cells; `x` → columns rightward, `y` → rows downward.

| Shape | Fields | Notes |
|---|---|---|
| box | `{type:'box', id, x, y, w, h, text?, style?}` | `style:'round'` for `╭─╮` corners; w/h auto-grow to fit text |
| arrow | `{type:'arrow', box1?, box2?, text?, heads?, style?, side1?, side2?}` | attach by box `id`s — routing is automatic; `heads:'both'\|'start'`, `style:'dashed'`; `side1`/`side2:'left'\|'right'\|'top'\|'bottom'` softly pin which box side each end anchors on (omit = auto) |
| group | `{type:'group', id, x, y, w, h, text?, lanes?}` | frame; contains whatever sits geometrically inside; `lanes:['A','B']` = swimlanes; titled groups need `h ≥ 5` |
| text | `{type:'text', x, y, text}` | free-standing annotation |

Free-floating arrows (no boxes): give `x1,y1,x2,y2` instead of `box1/box2`.

## Spacing rules (make first renders read well)

- Leave **≥ 8 columns** between connected boxes when the arrow has a label (`── label ──▶` needs the run), ≥ 4 otherwise.
- Leave **≥ 2 rows/columns** between any box and a group border it doesn't belong inside.
- Group membership is geometric: a box is in the group iff fully inside the frame, 1+ cell margin.
- Boxes never overlap each other or frames they aren't inside; keep arrow corridors clear of unrelated boxes.

## Example

```json
[
  {"type":"group","id":9,"x":26,"y":0,"w":44,"h":11,"text":"Backend"},
  {"type":"box","id":1,"x":0,"y":6,"w":12,"h":3,"text":"Client"},
  {"type":"box","id":2,"x":32,"y":6,"w":11,"h":3,"text":"API"},
  {"type":"box","id":3,"x":54,"y":6,"w":12,"h":3,"text":"Postgres","style":"round"},
  {"type":"arrow","box1":1,"box2":2,"text":"HTTP"},
  {"type":"arrow","box1":2,"box2":3,"text":"SQL","style":"dashed"}
]
```

## Common mistakes

- **Hand-drawing the grid** — labels beside (not on) an arrow and title-in-border groups (`┌─ Title ──┐`) silently import as stray text. Deliver JSON instead; only the renderer draws correct text.
- **Crowding** (mode 2) — a label overlapping any border corrupts both shapes. Spread out; cells are cheap.
- **Arrow coordinates instead of ids** — free endpoints don't re-attach when boxes move. Use `box1`/`box2`.
- **Editing rendered text by hand** — regenerate from JSON; alignment breaks invisibly.
