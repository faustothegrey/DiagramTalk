# Principles

## Coordinates are claims; geometry is truth.

*Verify geometry, don't infer it.*

A layout is only as correct as the collisions you actually compute. Position
data tells you where each element is *anchored* — not the footprint it occupies,
nor the space a connector traverses between its endpoints. So verify physically:
compute real geometry (shape-vs-shape footprints **and** connector-path-vs-shape
over the *whole* path, not just endpoints), and confirm by rendering. If you
didn't compute the intersection, you don't know it isn't there — and "the
coordinates look fine" is not evidence.

This is the linchpin of this skill. Everything else — auto-sizing, lanes,
anchors, colors — exists to make a diagram that *passes a physical check*, not
one that merely has tidy-looking numbers.

### Corollaries

- **Endpoints are not paths.** A line is defined by where it starts and ends, but
  it *collides* everywhere in between. Check the segment, not the two points.
- **Positions are not footprints.** An `(x, y)` is an anchor; the thing has
  width, height, and wrapped text. Compare extents, not anchors.
- **Render to confirm.** Geometric checks catch what the eye misses; the eye
  catches what the math got wrong. Use both — they fail differently.
- **A clean report you can't see is a hypothesis, not a result.** Trust
  "no collisions found" only for the collision *types you actually implemented*.
  Name the checks you ran; don't imply ones you didn't.

### In practice (this skill)

A diagram is not "done" until:

1. `layout … --dry-run` reports **empty `overlaps`** (boxes don't intersect), and
2. `arrowCrossings` is reviewed — every remaining crossing is acknowledged and
   justified, not silently shipped, and
3. you have **looked at a render** of the result, not just the coordinate report.

## Readability must preserve content.

Making a picture clearer by dropping elements isn't improvement, it's deletion.
Measure clarity at constant information: a readable diagram keeps every node and
every connector of the original and earns its clarity through layout, sizing,
color, and routing — never by quietly leaving things out.
