# Skill Limitations (readability)

The skill controls **what commands are sent** (shape types, labels, coordinates,
sizes). It does **not** control **how the app renders them** — that is decided by
the browser bridge (`components/DiagramApiBridge.tsx`) and the command schema
(`lib/diagramApiTypes.ts`). The items below are real readability problems that
cannot be fully fixed from inside `diagramtalk-api/` alone. They are recorded
here for a later pass that touches the app.

## 1. `note` shapes have a fixed, oversized footprint

- **Symptom:** Yellow notes are large (~200×200) and ignore any `w/h`, so they
  overlap nearby shapes and arrows. This was the dominant overlap in the first
  rendering.
- **Why the skill can't fix it:** `toCreateShapePartial` in the bridge only sets
  `richText` for `note` shapes — it drops `w/h`. tldraw then uses its default
  note size.
- **Skill workaround in place:** the layout engine renders annotations as
  **sized `box` shapes** in a reserved band, not as notes.
- **Real fix (app):** pass `w/h` (and `scale`/`growY`) through for notes, or add
  a dedicated "sticky/annotation" sizing path.

## 2. Box/ellipse text does not auto-grow to fit

- **Symptom:** If a label is longer than the box, text overflows below/outside
  the shape and reads poorly.
- **Why the skill can't fully fix it:** the skill can *estimate* a fitting size
  (it now does, via `estimate_label_size`), but the estimate is heuristic. tldraw
  geo shapes do not vertically grow to contain wrapped text unless `growY` is set.
- **Real fix (app):** set `growY` on geo shapes and/or a sane `verticalAlign`,
  and consider exposing font `size` (`s|m|l|xl`) in the command schema.

## 3. Arrows route as straight diagonals

- **Symptom:** Long edges cut straight across the canvas, crossing unrelated
  shapes and labels.
- **Why the skill can't fix it:** the bridge builds a single straight arrow
  between shape centers with center-anchored bindings; there is no orthogonal
  routing or obstacle avoidance, and the skill can't influence the binding
  anchors.
- **Skill mitigation:** the layout engine keeps connected nodes adjacent
  (left-to-right spine, branches directly above/below), which shortens edges and
  reduces crossings — but cannot eliminate them.
- **Real fix (app):** elbow/orthogonal arrow routing, smarter anchor selection,
  or per-edge anchor hints in the schema.

## 4. No styling controls (color, font size, z-order)

- **Symptom:** Everything is the same color; can't visually separate actors vs.
  states vs. annotations; can't push annotations behind the spine.
- **Why the skill can't fix it:** the command schema accepts only
  `type/label/x/y/w/h` for shapes — no `color`, `fill`, `font`, `size`, or
  z-index.
- **Real fix (app):** extend the createShape input + bridge to forward tldraw
  style props (`color`, `fill`, `dash`, `size`, `font`) and ordering.

## 5. Text rendering in exported SVG uses `foreignObject`

- **Symptom:** Exported SVGs (e.g. `Senza titolo.svg`) carry text in
  `<foreignObject>`, so some external SVG renderers (e.g. `rsvg-convert`) show
  empty shapes. The app itself renders text correctly.
- **Why the skill can't fix it:** export is handled in `lib/diagramExport.ts`,
  not the skill.
- **Real fix (app):** offer a native-`<text>` export mode for portability.
