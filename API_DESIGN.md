# DiagramTalk External API Design

## Purpose

DiagramTalk should expose an API that lets external systems inspect and interact with the diagram.

The API should not expose raw tldraw internals as the primary contract. External callers should work with DiagramTalk concepts:

- diagram context
- shapes
- labels
- connections
- commands
- questions about the diagram

Internally, the app can translate those concepts into tldraw editor operations.

## Current Constraint

In the current POC, the authoritative diagram state lives in the browser inside the active tldraw editor.

That means a normal server route cannot directly mutate the live canvas unless the browser participates. For example, `POST /api/diagram/shapes` on the server cannot call `editor.createShapes()` because the server does not own the editor instance.

This creates three possible architectures.

## Architecture Options

### Option 1: Snapshot-Backed API

The server stores tldraw snapshots. External callers read and write snapshots through API routes. The browser loads from the stored snapshot and saves changes back.

Pros:

- simple HTTP model
- external callers can inspect and modify diagrams when no browser is open
- good foundation for persistence

Cons:

- live browser synchronization needs extra work
- concurrent edits become a real problem
- commands may overwrite active user work if not merged carefully

### Option 2: tldraw Sync

Use tldraw sync so the browser and backend share a live document room. External callers modify the shared document state through the same persistence/sync layer.

Pros:

- correct long-term architecture for real-time collaboration
- external agents and humans can operate on the same document
- avoids ad hoc polling

Cons:

- larger infrastructure step
- requires choosing and hosting a sync backend
- may be too much before the product interaction is proven

### Option 3: Browser Command Bridge

The server stores a queue of diagram commands. External callers enqueue commands through API routes. The browser polls or subscribes to the command queue, applies commands using the live tldraw `Editor`, and reports results back.

Pros:

- fits the current POC
- fast to implement
- keeps the live editor as the authority
- lets us design the external API without taking on full sync infrastructure yet

Cons:

- commands only apply while the browser is open
- polling is less elegant than real-time sync
- not a persistence solution

## Recommended POC Direction

Use **Option 3: Browser Command Bridge** for the next milestone.

This is the most practical next step because the current app already has a live tldraw editor and normalized diagram context extraction.

The API can be designed now so that later we can replace the command transport with snapshot persistence or tldraw sync without changing the external contract too much.

## API Principles

- Keep external payloads stable and semantic.
- Avoid requiring callers to know tldraw shape internals.
- Return normalized diagram context, not raw editor state, by default.
- Make mutating operations command-based and explicit.
- Treat all externally submitted changes as proposed commands that the browser applies.
- Keep raw tldraw snapshots as an advanced/debug endpoint later, not the main API.

## Core Data Types

### Diagram Context

This should match the current internal `DiagramContext` shape.

```ts
type DiagramContext = {
  selectedShapeIds: string[]
  selectedShapes: DiagramShapeContext[]
  selectedConnections: DiagramConnectionContext[]
  shapes: DiagramShapeContext[]
  bindings: DiagramBindingContext[]
  connections: DiagramConnectionContext[]
  summary: {
    shapeCount: number
    connectionCount: number
    selectedShapeCount: number
    shapeTypes: Record<string, number>
  }
}
```

### Shape Input

External callers should use a smaller shape input model.

```ts
type CreateShapeInput = {
  id?: string
  type: 'box' | 'ellipse' | 'text' | 'note'
  label?: string
  x: number
  y: number
  w?: number
  h?: number
}
```

The app maps this to tldraw shapes:

- `box` -> tldraw `geo` rectangle
- `ellipse` -> tldraw `geo` ellipse
- `text` -> tldraw `text`
- `note` -> tldraw `note`

### Connection Input

```ts
type CreateConnectionInput = {
  id?: string
  fromShapeId: string
  toShapeId: string
  label?: string
  directional?: boolean
}
```

The app maps this to a tldraw arrow shape with arrow bindings:

- arrow start bound to `fromShapeId`
- arrow end bound to `toShapeId`
- arrow label from `label`
- end arrowhead enabled when `directional` is true

### Diagram Command

Commands are the bridge between external callers and the live browser editor.

```ts
type DiagramCommand =
  | {
      id: string
      type: 'createShape'
      input: CreateShapeInput
      status: 'pending' | 'applied' | 'failed'
      createdAt: string
      appliedAt?: string
      error?: string
    }
  | {
      id: string
      type: 'createConnection'
      input: CreateConnectionInput
      status: 'pending' | 'applied' | 'failed'
      createdAt: string
      appliedAt?: string
      error?: string
    }
```

## Proposed Endpoints

### `GET /api/diagram/context`

Returns the latest diagram context known to the server.

For the command-bridge POC, the browser must periodically publish context to the server. Without a browser session, this endpoint may return an empty or stale context.

Response:

```ts
type GetDiagramContextResponse = {
  context: DiagramContext | null
  updatedAt: string | null
}
```

### `POST /api/diagram/context`

Browser-only endpoint for publishing the latest normalized diagram context.

Request:

```ts
type PublishDiagramContextRequest = {
  context: DiagramContext
}
```

Response:

```ts
type PublishDiagramContextResponse = {
  ok: true
  updatedAt: string
}
```

This endpoint is an implementation detail of the command bridge. It is still useful because external callers need a server-readable view of the current diagram.

### `POST /api/diagram/commands`

External callers enqueue a command for the browser to apply.

Request:

```ts
type CreateDiagramCommandRequest =
  | {
      type: 'createShape'
      input: CreateShapeInput
    }
  | {
      type: 'createConnection'
      input: CreateConnectionInput
    }
```

Response:

```ts
type CreateDiagramCommandResponse = {
  command: DiagramCommand
}
```

### `GET /api/diagram/commands?status=pending`

Browser polls for pending commands.

Response:

```ts
type ListDiagramCommandsResponse = {
  commands: DiagramCommand[]
}
```

### `POST /api/diagram/commands/:id/result`

Browser reports whether a command was applied.

In Next.js App Router this would be implemented as:

```txt
app/api/diagram/commands/[id]/result/route.ts
```

Request:

```ts
type DiagramCommandResultRequest =
  | {
      status: 'applied'
    }
  | {
      status: 'failed'
      error: string
    }
```

Response:

```ts
type DiagramCommandResultResponse = {
  command: DiagramCommand
}
```

### `POST /api/diagram/ask`

Ask a question using the latest server-known diagram context.

This is useful for external callers that want to query the diagram without going through the browser chat panel.

Request:

```ts
type AskDiagramRequest = {
  question: string
}
```

Response:

```ts
type AskDiagramResponse = {
  answer: string
  contextUpdatedAt: string | null
}
```

Internally, this can reuse the same OpenRouter helper used by `/api/chat`.

## Browser Responsibilities

The browser should own a `DiagramApiBridge` component.

Responsibilities:

1. Track the current `DiagramContext`.
2. Publish context to `POST /api/diagram/context` after meaningful changes.
3. Poll `GET /api/diagram/commands?status=pending`.
4. Apply supported commands using the tldraw `Editor`.
5. Report command results to `POST /api/diagram/commands/:id/result`.

The bridge should live inside the tldraw editor context so it can access `useEditor()`.

## Applying Commands to tldraw

### Create Shape

For a `createShape` command:

1. Convert `CreateShapeInput` to a tldraw shape partial.
2. Call `editor.createShape()` or `editor.createShapes()`.
3. Optionally select the new shape.
4. Report `applied`.

### Create Connection

For a `createConnection` command:

1. Validate that `fromShapeId` and `toShapeId` exist.
2. Create an arrow shape.
3. Create arrow bindings from the arrow to both target shapes.
4. Add label rich text if provided.
5. Report `applied`.

This step needs careful implementation because tldraw arrow bindings are the real source of connectedness.

## Minimal POC Implementation

The first implementation should support:

- context publishing
- `GET /api/diagram/context`
- enqueue `createShape`
- browser polling for commands
- applying `createShape`
- reporting command status

Then add:

- enqueue `createConnection`
- applying bound arrows
- `POST /api/diagram/ask`

## Non Goals for First API Milestone

- authentication
- multi-user authorization
- permanent persistence
- tldraw sync integration
- external deletion/update commands
- raw tldraw snapshot editing
- webhooks
- streaming command results

## Security Notes

The POC can stay local-only, but the API shape should assume future hardening.

Before exposing this beyond local development, we need:

- authentication
- command authorization
- request size limits
- input validation
- rate limits
- a decision on whether external callers can mutate diagrams automatically or only propose changes

## Open Questions

- Should external commands be auto-applied or require user approval?
- Should commands target the current page only or accept a page ID?
- Should command IDs be caller-provided for idempotency?
- Should `/api/diagram/context` return stale context with a warning or fail when no browser is connected?
- Should the API eventually expose raw tldraw snapshots for power users?
- Should we adopt tldraw sync before supporting updates/deletes?

## Suggested Next Step

Implement the command bridge with only `createShape`.

That will validate the end-to-end architecture:

1. external caller posts a command
2. browser receives it
3. browser applies it to tldraw
4. browser reports result
5. updated diagram context becomes visible to the API and the LLM
