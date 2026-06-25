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
`render`, and `camera`.

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

## Practical Notes

- If commands remain `pending`, open the DiagramTalk app in a browser so the bridge can apply them.
- If `/api/diagram/context` is empty but the canvas has content, wait a moment or interact with the canvas to trigger context publishing.
- For large generated diagrams, queue shapes first, then connections. Connections fail if source or target shapes do not exist yet.
- Directional connections become tldraw arrows with an end arrowhead.
