# DiagramTalk Reference

Default base URL:

```txt
http://localhost:3000
```

Set `DIAGRAMTALK_URL` to override it.

## Active diagram

A workspace holds several named diagrams, but only **one is active at a time**.
The active diagram is the one loaded in the browser editor, so every
`/api/diagram/*` call (context, snapshot, commands, ask) acts on the active
diagram. To target a different diagram, make it active first
(`PATCH /api/diagrams/{id}` with `{ "active": true }`, or `diagramtalk.py use <id>`).

Diagrams are stored one file per diagram under `.diagramtalk/diagrams/<id>.json`,
with the active pointer in `.diagramtalk/index.json`.

## Endpoints

### `GET /api/diagram/context`

Returns the latest normalized diagram context published by the browser.

Useful fields:

- `context.shapes`
- `context.connections`
- `context.selectedShapes`
- `context.selectedConnections`
- `context.summary`

Every visible canvas element is addressable by id. Normal shapes appear in
`context.shapes[*].id`; connections are arrow shapes, so each connection's
`arrowId` is also present in `context.shapes` and can be used anywhere a shape
id is accepted. The API accepts either full tldraw ids (`shape:node-a`) or bare
ids (`node-a`) for commands that resolve shapes.

### `GET /api/diagram/snapshot`

Returns the **active** diagram's saved tldraw snapshot, along with its `id`,
`name`, and `updatedAt`.

### `GET /api/diagrams`

Lists every diagram and the active one:

```json
{
  "activeId": "3160cad0-...",
  "diagrams": [
    { "id": "3160cad0-...", "name": "AgentTalk Consensus Protocol",
      "createdAt": "...", "updatedAt": "..." }
  ]
}
```

### `POST /api/diagrams`

Creates a new diagram and makes it active. Body: `{ "name": "My diagram" }`
(`name` optional). Returns `{ "diagram": {...}, "activeId": "<new id>" }`.

### `GET /api/diagrams/{id}`

Returns a single diagram (including its `snapshot`) and the current `activeId`.

### `PATCH /api/diagrams/{id}`

Updates a diagram. Any subset of:

- `name`: rename (string, or `null` to clear).
- `snapshot`: replace the stored tldraw snapshot.
- `active`: `true` to make this diagram the active one.

Returns `{ "diagram": {...}, "activeId": "..." }`.

### `DELETE /api/diagrams/{id}`

Deletes a diagram. If the deleted diagram was active, the most recently created
remaining diagram becomes active. Returns `{ "deleted": true, "activeId": "..." }`.

### `POST /api/diagram/commands`

Queues a command for the browser bridge.

Create shape:

```json
{
  "type": "createShape",
  "input": {
    "id": "node-a",
    "type": "box",
    "label": "Node A",
    "x": 100,
    "y": 100,
    "w": 180,
    "h": 90,
    "color": "yellow",
    "fill": "semi"
  }
}
```

Allowed shape input types:

- `box`
- `ellipse`
- `text`
- `note`

Optional style fields (applied to geo/note/text shapes):

- `color`: `black, grey, light-violet, violet, blue, light-blue, yellow, orange,
  green, light-green, light-red, red, white`
- `fill` (geo only): `none, semi, solid, pattern`

Create connection:

```json
{
  "type": "createConnection",
  "input": {
    "id": "edge-a-b",
    "fromShapeId": "shape:node-a",
    "toShapeId": "shape:node-b",
    "label": "calls",
    "directional": true,
    "fromAnchor": "right",
    "toAnchor": "left",
    "color": "red"
  }
}
```

Optional connection fields:

- `fromAnchor` / `toAnchor`: which side of the source/target the arrow attaches
  to — `top, bottom, left, right, center`. Defaults to `center` (legacy
  center-to-center routing). Choosing sides keeps arrows out of box interiors.
- `color`: same palette as shapes.
- `routing`: `straight` (default) or `orthogonal`. `orthogonal` renders a
  tldraw **elbow** arrow (axis-aligned bends). The `layout` dry-run's
  `arrowCrossings` check follows the *routed* (elbow) path for these edges, not
  the straight segment, so checker and renderer agree. Note: orthogonal alone
  does not dodge intermediate boxes — pair it with `fromAnchor`/`toAnchor` that
  exit into the gaps (e.g. `bottom`→`bottom` to route below a row) and re-check
  the dry-run until the crossing clears.

Clear the active diagram:

```json
{
  "type": "clearDiagram"
}
```

Deletes every shape on the active diagram's page. Like other commands it is
queued and applied by the browser bridge, so it runs in order relative to any
`createShape`/`createConnection` commands queued after it (post `clearDiagram`
first to replace the canvas rather than merge onto it).

Highlight one or more existing elements in the live editor:

```json
{
  "type": "highlight",
  "input": {
    "ids": ["shape:node-a", "shape:edge-a-b"],
    "color": "yellow",
    "durationMs": 1600,
    "padding": 10
  }
}
```

`highlight` validates that every id resolves to an existing tldraw shape, then
shows a short pulse animation in the browser tab. It is view-only and transient:
it does not mutate the diagram, save to the snapshot, or appear in renders.
Because it is applied by the browser bridge, the app tab must be open. Missing
ids fail the command with `Shape not found: ...`.

Optional highlight fields:

- `color`: `yellow` (default), `blue`, `green`, `red`, or `violet`.
- `durationMs`: animation duration in milliseconds, from 100 to 10000
  (default 1600).
- `padding`: extra screen pixels around the highlighted element, from 0 to 80
  (default 10).

Set or move a dynamic state tag on a box/rectangle shape:

```json
{
  "type": "setStateTag",
  "input": {
    "shapeId": "shape:waiting",
    "label": "agent",
    "tagId": "agent-1",
    "color": "blue"
  }
}
```

`setStateTag` displays a compact badge at the target shape's top-right corner.
It is intended for state-machine diagrams where an external test runner wants
to show the agent's current state. Tags are live overlays: they do not mutate
the tldraw snapshot and do not appear in renders. Setting the same `tagId` on a
different shape moves that marker. Targets must be box/rectangle shapes; missing
or non-box targets fail the command.

Clear a marker:

```json
{
  "type": "setStateTag",
  "input": {
    "tagId": "agent-1",
    "clear": true
  }
}
```

Optional state tag fields:

- `tagId`: logical marker id, default `agent`.
- `color`: `blue` (default), `green`, `yellow`, `red`, `violet`, or `grey`.

**Targeting a specific diagram.** Any command may include an optional
`diagramId` (validated to exist, else `404`) to act on a diagram other than the
active one:

```json
{ "type": "createShape", "diagramId": "<id>", "input": { /* ... */ } }
```

When omitted the command applies to the active diagram (legacy behavior). When
set, the open app tab **auto-activates** that diagram — it switches to it,
applies the command, and saves — so edits land on the right diagram without a
separate `use` call. (tldraw runs only in the browser, so this still needs an
app tab open; the targeted diagram becomes the active one afterward.) The CLI
exposes this as `--diagram <id>` on `shape`, `connect`, `clear`, `layout`,
`render`, `camera`, `highlight`, and `tag`.

Move the camera (view only — never mutates or persists shapes):

```json
{ "type": "setCamera", "input": { "mode": "topLeft", "margin": 40 } }
```

`input` is one of three mutually-exclusive modes:

- `{ "mode": "fit", "padding"?: number }` — zoom to fit all content, centered
  (`padding` is the inset in px, default 32).
- `{ "mode": "topLeft", "margin"?: number, "zoom"?: number }` — frame the
  content near the viewport's top-left, leaving the right/bottom open (where the
  flow extends). `margin` is px from the top-left edge (default 40); `zoom` is an
  explicit zoom, otherwise one is picked so the diagram sits in roughly the
  upper-left of the viewport.
- `{ "mode": "absolute", "x": number, "y": number, "zoom": number }` — set the
  tldraw camera directly (page coordinates + zoom).

Honors `diagramId` (auto-activates that diagram before framing). With no content
on the page, `fit`/`topLeft` are no-ops. CLI: `camera --fit [--padding N]`,
`camera --top-left [--margin N] [--zoom Z]`, `camera --x X --y Y --zoom Z`.

### `GET /api/diagram/commands`

Lists queued commands and statuses.

Filter pending commands:

```txt
GET /api/diagram/commands?status=pending
```

Statuses:

- `pending`
- `applied`
- `failed`

### `POST /api/diagram/ask`

Asks the LLM about the latest server-known diagram context.

```json
{
  "question": "What does this diagram describe?"
}
```

### Render endpoints (`/api/diagram/render`)

Rendering is pull-based: only the browser bridge can rasterize tldraw, so a
caller requests a render, the active diagram's bridge exports the page and
uploads it, and the result is cached per diagram id. Use the
`diagramtalk.py render` CLI which wraps the whole flow.

- `POST /api/diagram/render` — request a fresh render. Body `{ "id"?: string,
  "format"?: "png" | "svg" }` (`id` defaults to the active diagram, `format`
  defaults to `png`). Returns `{ id, format, requestedAt }` (202).
- `GET /api/diagram/render?id=<id>&meta=1` — render metadata:
  `{ id, format, renderedAt, request }`. Poll until `renderedAt >= requestedAt`
  to know a fresh render is ready.
- `GET /api/diagram/render?id=<id>` — the cached render **bytes**
  (`Content-Type: image/png` or `image/svg+xml`, plus an `X-Rendered-At`
  header). `404` until a render exists.
- `PUT /api/diagram/render` — used by the bridge to upload a result. Body
  `{ id, format, data }` (`data` is base64 for png, raw markup for svg).

Renders need the app tab open; with no tab the request stays unfulfilled and
`render` times out.

### Save endpoints (`/api/diagram/save`)

The canvas already autosaves on every change; these force an explicit save of
the current canvas now and confirm it. Like render, it is pull-based: the bridge
flushes the live snapshot.

- `POST /api/diagram/save` — request a save. Body `{ "id"?: string }`
  (defaults to the active diagram). Returns `{ id, requestedAt }` (202).
- `GET /api/diagram/save?id=<id>` — save status:
  `{ id, savedAt, request }`. Poll until `savedAt >= requestedAt`.

Needs the app tab open (the bridge performs the save). CLI: `save [--diagram <id>]`.
The UI's **Save** button (next to New/Delete) does the same flush directly.

If the target diagram has an active recording, `POST /api/diagram/save` returns
`409` with `{ error, recordingId }`. Snapshot persistence is frozen during a
recording so the base diagram is not overwritten by a run.

### Recording endpoints (`/api/diagram/recordings`)

A recording is a persisted timed reproduction log for externally driven
diagram events. It records only driver-originated visual events that happen via
the command bridge today:

- `highlight`
- `setStateTag`

Start a recording:

```json
POST /api/diagram/recordings
{
  "diagramId": "<diagram id>",
  "name": "Agent run 42"
}
```

`diagramId` defaults to the active diagram. The response includes
`{ recording, activeId }`. Only one recording is active at a time; starting a
new one closes any previous open recording and makes the new recording active.

When the browser bridge applies a `highlight` or `setStateTag` command and
reports it as applied, the server appends an event to the active recording if
the command's diagram matches the recording's `diagramId`. Each event includes:

- `type`: `highlight` or `setStateTag`
- `input`: the original command input
- `commandId`
- `occurredAt`: ISO timestamp when the command was reported applied
- `elapsedMs`: milliseconds since `recording.startedAt`

While a recording is active for a diagram, the diagram's snapshot persistence is
disabled. Browser autosave and explicit save requests do not update the diagram
file; run-time visual events should be expressed as `highlight` and
`setStateTag`, which are appended to the recording. End the recording before
making structural edits that should persist as the new base diagram.

End the current recording:

```txt
PATCH /api/diagram/recordings/active
```

Fetch recordings:

```txt
GET /api/diagram/recordings
GET /api/diagram/recordings/{id}
GET /api/diagram/recordings/active
```

CLI:

```bash
python3 diagramtalk/scripts/diagramtalk.py record start --name "Agent run"
python3 diagramtalk/scripts/diagramtalk.py highlight shape:waiting
python3 diagramtalk/scripts/diagramtalk.py tag shape:waiting agent --tag-id agent-1
python3 diagramtalk/scripts/diagramtalk.py record end
python3 diagramtalk/scripts/diagramtalk.py record show <recording-id>
```

Recordings persist under `.diagramtalk/recordings/`; the active recording
pointer is `.diagramtalk/recordings-index.json`. Recording does not replay yet;
it stores enough timed data for a later playback facility.

### Browser regression checks

The app includes Playwright e2e coverage for browser-only behavior:

```bash
npm run test:e2e
```

The suite starts a separate dev server on `http://localhost:3001` by default and
drives Chromium. It verifies that the browser bridge applies shape/connection
commands, targeted diagram commands auto-activate the correct diagram, explicit
save persists a snapshot, PNG/SVG renders are non-empty, camera commands move
the live viewport, highlight commands are transient, state tags move between
states, and recordings persist timed highlight/tag events.

## Practical Notes

- If commands remain `pending`, open the DiagramTalk app in a browser so the bridge can apply them.
- If `/api/diagram/context` is empty but the canvas has content, wait a moment or interact with the canvas to trigger context publishing.
- For large generated diagrams, queue shapes first, then connections. Connections fail if source or target shapes do not exist yet.
- Directional connections become tldraw arrows with an end arrowhead.
