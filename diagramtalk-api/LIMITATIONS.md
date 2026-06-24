# Skill Limitations & Roadmap (readability)

The skill controls **what commands are sent** (shape types, labels, coordinates,
sizes, and now colors/anchors). It does **not** control the parts of rendering
that have no field in the command schema. This file tracks what has been fixed
in the app bridge and what is still open.

- Bridge: `components/DiagramApiBridge.tsx`
- Command schema: `lib/diagramApiTypes.ts` + `app/api/diagram/commands/route.ts`

---

## Resolved in the bridge — option A

### A1. Color / fill (was: "the original colors were lost")

**What you saw.** After the readability pass the yellow notes turned into plain
boxes. Here is exactly why: the original yellow came **entirely from `note`
shapes** — tldraw renders notes yellow by default; nobody ever set a color. The
readability pass swapped every annotation from `note` → `box`, because the bridge
**dropped `w/h` for notes** and that fixed ~200px note footprint was the *main*
overlap you first complained about. A `box` can be sized; a `note` cannot. But a
`box` rendered with no fill, so the yellow disappeared. It was a **trade: color
spent to buy size/overlap control**, and with no `color` field in the schema the
skill couldn't have both.

**Fix.** `CreateShapeInput` now has `color` and `fill`; the bridge forwards them
to geo/note/text shapes. `CreateConnectionInput` has `color` for arrows. The
layout engine takes `color`/`fill` per lane or per node, so annotations can be
sized **and** yellow (`"color": "yellow", "fill": "semi"`), and roles can be
color-coded.

### A2. Arrow anchor sides (was: "arrows still cross boxes")

**What you saw.** Arrows cut straight through boxes. Why: the bridge drew **every
arrow as a straight line from shape-center to shape-center**, with both binding
anchors pinned at the center. There was no orthogonal/elbow routing, no obstacle
avoidance, and no way to pick which **side** of a box an arrow leaves or enters.
So any edge whose endpoints aren't roughly adjacent cut straight across whatever
sat between them.

**Fix (partial).** `CreateConnectionInput` now takes `fromAnchor`/`toAnchor`
(`top|bottom|left|right|center`); the bridge binds the arrow to that exact edge
point (precise binding) instead of the center. The layout engine auto-assigns
sides from geometry (horizontal edges leave the right / enter the left; vertical
edges leave the bottom / enter the top), so arrows stay on box edges and out of
interiors.

**Still not solved here:** this picks *where arrows attach*, not *the path
between*. Arrows are still straight segments, so a long edge can still pass over
an unrelated box. See "Open — arrow routing" below.

---

## Still open (needs more bridge work)

### Note shapes still have a fixed footprint
`note` shapes still ignore `w/h`, which is why the skill uses sized `box` shapes
for annotations. If we ever want true sticky-notes at a controlled size, the
bridge must forward `w/h`/`scale`/`growY` for notes.

### Box text does not auto-grow
The skill *estimates* a fitting size, but tldraw geo shapes don't vertically grow
to contain wrapped text unless `growY` is set. Long labels can still overflow.
Fix: set `growY` (and a sane `verticalAlign`) on geo shapes; optionally expose
font `size` (`s|m|l|xl`).

### Arrow routing (the rest of A2)
Anchor sides help, but there is still no elbow/orthogonal routing or obstacle
avoidance — long edges remain straight diagonals. tldraw arrows are straight or
curved (`bend`) only; real orthogonal routing would need either a custom arrow
util or a routing pass that inserts waypoints.

We can now **measure** the problem: the layout dry-run reports `arrowCrossings`
(line-segment vs. rectangle for every arrow against every unrelated box), so we
know exactly which arrows cut through which boxes — not just box-vs-box overlap.
This is the metric a routing pass or the placement pass (B) would minimize.

### SVG export uses `foreignObject`
Exported SVGs carry text in `<foreignObject>`, so some external renderers show
empty shapes (the app renders fine). Lives in `lib/diagramExport.ts`.

---

## B — deferred: skill-only placement pass

Recorded for later, per our discussion. Independent of the bridge, the layout
engine could **cut crossings through placement alone**:

- Align each actor **directly above its spine target** (via `col`) so the
  actor→spine arrows become short near-verticals instead of diagonals.
- Cluster `Interrupted`'s four feeder-notes **right under it (centered)** so the
  error-fan arrows become short verticals instead of long diagonals across the
  band.
- Order nodes within a lane to minimize edge crossings (barycenter heuristic).

This **reduces** crossings; it cannot eliminate them, and it brings back **zero**
color on its own. The durable result is **B (placement) + A2 (anchors/routing)
together**: good positions, clean attachment, and — eventually — routed paths.
