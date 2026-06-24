# DiagramTalk API Reference

Default base URL:

```txt
http://localhost:3000
```

Set `DIAGRAMTALK_URL` to override it.

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

Returns the saved tldraw snapshot and `updatedAt`. Snapshots are stored in `.diagramtalk/diagram-snapshot.json`.

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

## Practical Notes

- If commands remain `pending`, open the DiagramTalk app in a browser so the bridge can apply them.
- If `/api/diagram/context` is empty but the canvas has content, wait a moment or interact with the canvas to trigger context publishing.
- For large generated diagrams, queue shapes first, then connections. Connections fail if source or target shapes do not exist yet.
- Directional connections become tldraw arrows with an end arrowhead.
