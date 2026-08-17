---
name: drawing-plaintext-diagrams
description: Use when creating or editing box-and-arrow diagrams as text — architecture sketches, flow diagrams, or anything destined for the plaintext.diagrams editor (paste-import), a README, or a code comment. Also use when a hand-drawn ASCII/Unicode diagram fails to import or its labels/groups get lost.
---

# Drawing plaintext.diagrams

## Overview

plaintext.diagrams (https://melonmanchan.github.io/plaintext.diagrams/) is a diagram editor whose file format IS the rendered Unicode text. It ALSO paste-imports **shapes JSON** directly — lossless, no grid geometry to get right. Describe shapes as JSON; never hand-draw the character grid.

## Two delivery modes

1. **Diagram for the app** (user will paste/edit it): deliver the **shapes JSON itself**. The editor detects JSON on paste (clipboard starting with `[` or `{`), validates it, and imports losslessly — invalid JSON shows the first error in the hint bar. Done; no tooling needed.
2. **Diagram as text** (README, PR description, code comment): render the JSON to Unicode text with the bundled renderer and iterate until the round-trip check passes:

```bash
node render.mjs --check shapes.json > diagram.txt   # render.mjs sits next to this file; bun works too
```

`--check` re-imports the render through the app's parser and fails loudly if anything (boxes, groups, arrows, labels) would be lost. The rendered text is also paste-importable.

## Shape schema

A JSON array (or `{"shapes": [...]}`). Coordinates are character cells; `x` → columns rightward, `y` → rows downward.

| Shape | Fields | Notes |
|---|---|---|
| box | `{type:'box', id, x, y, w, h, text?, style?}` | `style:'round'` for `╭─╮` corners; w/h auto-grow to fit text |
| arrow | `{type:'arrow', box1?, box2?, text?, heads?, style?}` | attach by box `id`s — routing is automatic; `heads:'both'\|'start'`, `style:'dashed'` |
| group | `{type:'group', id, x, y, w, h, text?, lanes?}` | frame; contains whatever sits geometrically inside; `lanes:['A','B']` = swimlanes; titled groups need `h ≥ 5` |
| text | `{type:'text', x, y, text}` | free-standing annotation |

Free-floating arrows (no boxes): give `x1,y1,x2,y2` instead of `box1/box2`.

## Spacing rules (matter most for mode 2's renderer)

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
