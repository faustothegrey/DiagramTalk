---
name: diagramtalk
description: Work with a local DiagramTalk whiteboard app, inspect and modify the canvas, ask the DiagramTalk LLM about the diagram, and generate readable layouts that are checked for overlaps and arrow crossings rather than guessed from coordinates. Use when Codex or another agent needs to inspect the current diagram, add shapes or connections, verify snapshot persistence, improve diagram readability, or generate diagrams programmatically in the running Next.js/tldraw app.
---

# DiagramTalk

## Core principle — coordinates are claims; geometry is truth

**Verify geometry, don't infer it.** A diagram is only as correct as the
checks you actually ran. Compute the geometry first, then confirm it with a
render. Coordinates that "look fine" are not evidence: an `(x, y)` is an
anchor, not a footprint, and an arrow can cross a box anywhere between its
endpoints, not just at them.

This is the linchpin of the skill. Auto-sizing, lanes, anchors, and colors all
exist to produce a diagram that **passes the checks we implement**. A diagram
is not "done" until `layout … --dry-run` shows empty `overlaps`, every
remaining `arrowCrossing` is acknowledged, and you have seen a render. Full
statement and corollaries:
[`PRINCIPLES.md`](PRINCIPLES.md).

## Overview

Use this skill to interact with a running DiagramTalk app, normally at `http://localhost:3000`.

Prefer the bundled CLI wrapper for routine operations:

```bash
python3 scripts/diagramtalk.py context
```

Set `DIAGRAMTALK_URL` if the app runs elsewhere.

```bash
DIAGRAMTALK_URL=http://localhost:3001 python3 scripts/diagramtalk.py context
```

## Workflow

1. Check that the app is running:

```bash
curl -I "${DIAGRAMTALK_URL:-http://localhost:3000}"
```

2. Pick the diagram to work on. A workspace holds several named diagrams but
   only one is **active**, and every command acts on the active one. List them
   and, if needed, switch or create one before editing:

```bash
python3 scripts/diagramtalk.py diagrams          # list all + the active id
python3 scripts/diagramtalk.py new "My Diagram"  # create one and make it active
python3 scripts/diagramtalk.py use <id>          # switch the active diagram
```

3. Inspect current diagram context before changing it:

```bash
python3 scripts/diagramtalk.py context
```

4. For anything bigger than one or two shapes, describe the diagram in a
   **layout spec** and let the engine compute collision-free coordinates
   instead of placing shapes by hand (see "Readability & Layout" below). Use
   `shape`/`connect` only for small edits.

5. **Verify the geometry before posting (the core gate).** Run the spec through
   `layout … --dry-run` and read the physical collision report. Do not post
   until `overlaps` is empty and every `arrowCrossing` is either gone or
   consciously accepted. See "Readability & Layout" for the report format.

6. Post (`layout … --post`) and wait for the browser bridge to apply commands:

```bash
python3 scripts/diagramtalk.py commands --status pending
```

7. Use `highlight` when you need to direct a human's attention to specific
   elements in the live tab without changing the diagram. It is a transient
   overlay, not a saved shape:

```bash
python3 scripts/diagramtalk.py highlight shape:<id> --color blue
```

8. **Confirm with your eyes, not just the report.** Verify the diagram context
   and saved snapshot, and render the result to an actual image so you can see
   it — geometric checks and visual checks fail differently, so use both
   ([`PRINCIPLES.md`](PRINCIPLES.md)):

```bash
python3 scripts/diagramtalk.py render --out /tmp/diagram.png
```

## Readability & Layout

The single biggest cause of unreadable diagrams is hand-picking `x/y` for every
shape: shapes overlap, annotations cover the spine, and arrows cross the canvas.
Avoid that — let the tooling handle geometry.

**Rules of thumb**

- **Don't compute coordinates by hand.** Use the `layout` command with a spec.
- **Let shapes auto-size.** Omit `--w/--h` (and `w/h` in specs) so each shape is
  sized to fit its label. Labels stay inside the box.
- **Keep labels short.** Put long explanations in the annotation band, not in a
  spine node.
- **Group into lanes.** One lane per semantic row (actors, the happy-path spine,
  branch/error states). Lanes stack vertically and never overlap.
- **Put notes/rules in the annotation band.** Annotations render as sized boxes
  in a reserved band below the diagram, so they never sit on top of the spine.
  (Do not use `note` shapes for this — see `LIMITATIONS.md`.)
- **Align branches under their spine node** with `"col": <index>` (the index of
  the spine node in the grid lane).
- **Color-code by role.** Set `color`/`fill` per lane (or per node to override)
  so actors, happy-path states, error states, and annotations read as distinct
  groups. Annotation boxes with `"color": "yellow", "fill": "semi"` recreate the
  old sticky-note look while staying sized. Edges take an optional `color` too.
- **Let arrows pick their sides automatically.** The engine assigns each edge an
  exit/entry side from geometry (horizontal edges leave the right / enter the
  left; vertical edges leave the bottom / enter the top) so arrows stay out of
  box interiors. Override per edge with `"fromAnchor"`/`"toAnchor"`
  (`top|bottom|left|right|center`) when you want a specific routing.

Allowed `color`: `black, grey, light-violet, violet, blue, light-blue, yellow,
orange, green, light-green, light-red, red, white`. Allowed `fill`: `none, semi,
solid, pattern`.

**Layout spec** (JSON). Lanes are drawn top-to-bottom; the lane marked
`"grid": true` defines the column positions that other lanes align to via `col`.

```json
{
  "config": { "originX": 80, "originY": 120, "colGap": 90, "rowPitch": 190 },
  "lanes": [
    { "id": "actors", "type": "ellipse", "color": "light-blue", "fill": "semi",
      "nodes": [ { "id": "user", "label": "User / UI" } ] },
    { "id": "spine", "type": "box", "grid": true, "color": "blue", "fill": "semi",
      "nodes": [ { "id": "ack", "label": "Ack" },
                 { "id": "facts", "label": "Fact Collect" } ] },
    { "id": "branches", "type": "box", "color": "red", "fill": "semi",
      "nodes": [ { "id": "interrupted", "label": "Interrupted", "col": 1 } ] }
  ],
  "annotations": [
    { "id": "timers", "label": "Timers: facts 480s, watchdog 900s",
      "color": "yellow", "fill": "semi" }
  ],
  "edges": [
    { "id": "e1", "from": "ack", "to": "facts", "label": "both acked" }
  ]
}
```

Preview the computed geometry first. The dry-run runs two physical collision
checks and reports both:

- `overlaps` — boxes whose rectangles intersect (hard failure; exits non-zero).
- `arrowCrossings` — arrows whose path slices through a box they are not
  connected to (reported as warnings; line-segment vs. rectangle, so it catches
  mid-path crossings that coordinate reading alone misses). For an edge with
  `routing: "orthogonal"` the check follows the routed elbow path, not the
  straight segment.

`ok` is true only when both are empty.

To clear a crossing on a back-edge or long-range edge, set
`routing: "orthogonal"` on it **and** pick `fromAnchor`/`toAnchor` that exit
into the gaps (e.g. `bottom`→`bottom` to route below a row), then re-run the
dry-run — orthogonal alone keeps the same lane and does not dodge intermediate
boxes. On the bundled example this drops crossings from 5 to 1.

```bash
python3 scripts/diagramtalk.py \
  layout examples/consensus-protocol.json --dry-run
```

Then queue it to the running app:

```bash
python3 scripts/diagramtalk.py \
  layout examples/consensus-protocol.json --post
```

A complete, ready-to-run example for the AgentTalk consensus protocol is in
`examples/consensus-protocol.json`.

## Common Operations

Create a shape (omit `--w/--h` to auto-size the box to its label; `--color`/
`--fill` are optional):

```bash
python3 scripts/diagramtalk.py shape \
  --id example-node \
  --type box \
  --label "Example Node" \
  --x 100 --y 100 \
  --color yellow --fill semi
```

Create a connection (`--from-anchor`/`--to-anchor` pick which side the arrow
attaches to; `--color` tints the arrow; `--routing orthogonal` draws an elbow):

```bash
python3 scripts/diagramtalk.py connect \
  --id example-edge \
  --from shape:example-node \
  --to shape:other-node \
  --label "calls" \
  --from-anchor right --to-anchor left \
  --routing straight
```

Ask about the latest published diagram context:

```bash
python3 scripts/diagramtalk.py ask \
  "What are the main states in this diagram?"
```

Check the active diagram's saved snapshot metadata/content:

```bash
python3 scripts/diagramtalk.py snapshot
```

Highlight existing elements in the live app by id (view-only, transient, not
saved). Use ids from `context.shapes`; connection `arrowId` values are also
shape ids and can be highlighted:

```bash
python3 scripts/diagramtalk.py highlight shape:example-node
python3 scripts/diagramtalk.py highlight shape:example-node shape:example-edge --color blue
python3 scripts/diagramtalk.py highlight example-node --duration 2500 --padding 16
```

Allowed highlight colors are `yellow`, `blue`, `green`, `red`, and `violet`.
Highlight commands fail if any id is missing. They do not change the snapshot,
so they are safe for pointing at something during a review or handoff.

Manage diagrams (list, create + activate, switch, rename, delete):

```bash
python3 scripts/diagramtalk.py diagrams
python3 scripts/diagramtalk.py new "AgentTalk Consensus Protocol"
python3 scripts/diagramtalk.py use <id>
python3 scripts/diagramtalk.py rename <id> "New name"
python3 scripts/diagramtalk.py delete <id>
```

Clear the active diagram, or replace it in one shot from a spec:

```bash
python3 scripts/diagramtalk.py clear
python3 scripts/diagramtalk.py layout spec.json --replace   # clear, then post the spec
```

Target a diagram other than the active one with `--diagram <id>` (on `shape`,
`connect`, `clear`, `layout`, `render`, `camera`, and `highlight`). The open app
tab auto-switches to that diagram to apply the command and that diagram becomes
active:

```bash
python3 scripts/diagramtalk.py layout spec.json --replace --diagram <id>
```

Render the active diagram to an image (needs the app tab open):

```bash
python3 scripts/diagramtalk.py render --out /tmp/diagram.png          # png
python3 scripts/diagramtalk.py render --format svg --out /tmp/diagram.svg
```

Move the on-screen view (camera only — never changes shapes). Use this to frame
the live viewport, e.g. so the diagram sits top-left with the right/bottom open
for where the flow will extend:

```bash
python3 scripts/diagramtalk.py camera --fit                  # whole diagram, centered
python3 scripts/diagramtalk.py camera --top-left             # upper-left, room to the right
python3 scripts/diagramtalk.py camera --top-left --margin 60 --zoom 1
python3 scripts/diagramtalk.py camera --x 0 --y 0 --zoom 1   # absolute
```

Note: `render` always exports the content's bounding box, so it does **not**
reflect the camera/viewport framing — `camera` controls what a person sees in
the app, not the rendered image.

Force-save the current canvas now and wait for it to persist (the canvas also
autosaves continuously, so this is an explicit checkpoint):

```bash
python3 scripts/diagramtalk.py save
python3 scripts/diagramtalk.py save --diagram <id>
```

Run browser-level regression checks. The Playwright suite starts a separate app
server on `localhost:3001`, drives Chromium, and verifies the command bridge,
targeted diagrams, explicit save, render, camera, and highlight behavior:

```bash
npm run test:e2e
```

## Important Constraints

- Mutating commands require an open browser session running DiagramTalk; the browser bridge applies queued commands through tldraw. The same is true of `render`, `save`, and `highlight`: with no app tab open the request stays unfulfilled or the command stays pending.
- Server command queue state is in memory and resets on Next.js restart.
- Diagrams persist locally, one file per diagram in `.diagramtalk/diagrams/<id>.json`, with the active pointer in `.diagramtalk/index.json`. Only the active diagram is loaded in the editor and acted on by commands.
- The `.diagramtalk/` directory is git-ignored; do not commit user diagrams unless explicitly asked.
- Use stable caller-provided IDs when generating diagrams so later commands can connect to known shapes.
- Shape IDs accepted by the API may be bare IDs like `agent-a` or full tldraw IDs like `shape:agent-a`.
- Every visible element has a tldraw shape id. Connections are arrow shapes, so
  use their `arrowId` from `context.connections` (or matching `context.shapes`
  entry) when highlighting or addressing a connection.
- Playwright output is ignored (`test-results/`, `playwright-report/`). Keep
  `next-env.d.ts` generated route-path flips out of commits unless the user asks
  for build metadata changes.

## Reference

For endpoint details and payload shapes, read:

- [`PRINCIPLES.md`](PRINCIPLES.md) — the core principle this skill is built on;
  read first
- `references/api.md`
- `examples/consensus-protocol.json` — a full layout spec example
- `LIMITATIONS.md` — readability issues that the skill cannot fix on its own
  because they live in the app's rendering bridge (note sizing, box text
  auto-grow, arrow routing). Read before promising pixel-perfect output.
