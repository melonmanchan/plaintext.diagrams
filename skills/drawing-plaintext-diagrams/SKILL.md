---
name: drawing-plaintext-diagrams
description: Use when creating or editing box-and-arrow diagrams as text — architecture sketches, flow diagrams, or anything destined for the plaintext.diagrams editor (paste-import), a README, or a code comment. Also use when a hand-drawn ASCII/Unicode diagram fails to import or its labels/groups get lost.
---

# Drawing plaintext.diagrams

## Overview

plaintext.diagrams (https://melonmanchan.github.io/plaintext.diagrams/) is a diagram editor whose file format IS the rendered Unicode text: what you export is what you paste back in, fully editable. Character-grid alignment is unforgiving, so **never hand-draw the grid**. Describe shapes as JSON and let the app's own renderer draw it:

```bash
node render.mjs --check shapes.json > diagram.txt   # render.mjs sits next to this file; bun works too
```

`--check` re-imports the output through the app's parser and fails loudly if anything (boxes, groups, arrows, labels) would be lost.

## Shape schema

Input: JSON array (or `{"shapes": [...]}`). Coordinates are character cells; `x` → columns rightward, `y` → rows downward.

| Shape | Fields | Notes |
|---|---|---|
| box | `{type:'box', id, x, y, w, h, text?, style?}` | `style:'round'` for `╭─╮` corners; w/h auto-grow to fit text |
| arrow | `{type:'arrow', box1?, box2?, text?, heads?, style?}` | attach by box `id`s — routing is automatic; `heads:'both'\|'start'`, `style:'dashed'` |
| group | `{type:'group', id, x, y, w, h, text?, lanes?}` | frame; contains whatever sits geometrically inside; `lanes:['A','B']` = swimlanes; titled groups need `h ≥ 5` |
| text | `{type:'text', x, y, text}` | free-standing annotation |

Free-floating arrows (no boxes): give `x1,y1,x2,y2` instead of `box1/box2`.

## Workflow

1. Write `shapes.json`. Attach arrows by box ids, never coordinates.
2. Render with `--check`; deliver the emitted text.
3. Check failed? The hint is almost always right: **spread shapes out** and re-run.

## Spacing rules (why checks fail)

- Leave **≥ 8 columns** between connected boxes when the arrow has a label (`── label ──▶` needs the run), ≥ 4 otherwise.
- Leave **≥ 2 rows/columns** between any box and a group border it doesn't belong inside.
- Group membership is geometric: a box is in the group iff fully inside the frame. Leave 1+ cell margin inside frames.
- Boxes never overlap each other or frames they aren't inside.

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

- **Hand-drawing the grid** — labels beside (not on) an arrow and title-in-border groups (`┌─ Title ──┐`) silently import as stray text, not shapes. Groups are double-line `╔═╗` frames with the title in a tab; only the renderer gets this right.
- **Crowding** — a label overlapping any border corrupts both shapes. Spread out; cells are cheap.
- **Arrow coordinates instead of ids** — free endpoints don't re-attach when boxes move. Use `box1`/`box2`.
- **Editing the rendered text** — regenerate from JSON instead; alignment breaks invisibly.
