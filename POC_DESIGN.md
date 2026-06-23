# DiagramTalk Proof of Concept Design

## Purpose

The proof of concept should validate one central idea:

> A user can draw a diagram, select part of it, ask a question, and get an LLM answer grounded in the selected element and the wider diagram context.

This POC is not trying to build the final product. It should be small enough to implement quickly, while still exercising the real interaction between canvas state, selection, chat, and an LLM API call.

## Stack

- Next.js with the App Router
- React
- TypeScript
- tldraw for the whiteboard canvas
- OpenRouter for LLM access

The OpenRouter API key must stay server-side. The browser should call a Next.js route handler, and the route handler should call OpenRouter.

Recommended package choices:

- `next`
- `react`
- `react-dom`
- `typescript`
- `tldraw`
- no UI component library for the POC

The first implementation should keep styling in plain CSS. A design system can come later if the product direction becomes clearer.

## POC Screen

The first screen should be the actual workspace, not a landing page.

Layout:

- left/main area: tldraw canvas
- right side panel: chat
- small context area in the chat panel showing what is currently selected

The interface should make selection obvious. When the user selects something on the canvas, the chat panel should reflect that selection before the user asks a question.

Desktop layout:

- full viewport height
- canvas fills remaining width
- chat panel fixed to the right, around 360-420px wide
- no top navigation in the first version

Small-screen layout can be basic for the POC. The simplest acceptable behavior is stacking the chat below the canvas or letting the workspace use a minimum desktop width.

## UX Details

The POC should optimize for the one important workflow: draw, select, ask.

The chat panel should include:

- a short title, such as "Diagram Chat"
- selection summary
- scrollable message list
- text input
- submit button

The selection summary should be visible above the input so the user knows what context will be sent.

States:

- no selection: "No selection"
- one selected shape: show shape type and ID
- multiple selected shapes: show count and shape types
- loading: disable input submit and show that the assistant is thinking
- API error: show a compact error message in the chat stream

The POC does not need elaborate empty states, onboarding copy, or a landing page.

## User Flow

1. User opens the app.
2. User draws a few shapes, labels, and arrows.
3. User selects one shape or arrow.
4. Chat panel shows a compact summary of the current selection.
5. User types a question, for example: "Does this link make sense?"
6. Browser sends the question plus normalized diagram context to `/api/chat`.
7. Server calls OpenRouter.
8. Assistant response appears in the chat panel.

## Initial Feature Set

### Canvas

Use tldraw as the editor. The POC should rely on built-in tldraw behavior for drawing, selecting, editing text, arrows, and moving shapes.

We should avoid custom canvas tools in the first pass.

### Diagram Awareness

The app needs access to:

- selected shape IDs
- selected shape records with readable labels
- all current-page shape records
- tldraw arrow bindings
- derived arrow connections
- related connections for the current selection

The model should receive normalized diagram context, not only raw tldraw state. Raw props can still be included as a fallback, but the useful layer is the derived graph: shapes, labels, and arrow relationships.

Diagram context must be serializable. Do not send the editor object or functions to the API route.

Current shape context:

```ts
type DiagramShapeContext = {
  id: string
  type: string
  label?: string
  props?: unknown
  x?: number
  y?: number
  rotation?: number
  bounds?: { x: number; y: number; w: number; h: number }
}
```

Current diagram context:

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

Arrow connections are derived from tldraw arrow bindings. In a binding, `fromId` is the arrow shape and `toId` is the shape it binds to. The binding prop `terminal` tells whether the target is attached to the arrow `start` or `end`.

### Chat

The chat panel should support:

- user messages
- assistant messages
- loading state
- error state
- disabled submit when there is no question

The first version can keep chat state in memory. Refresh persistence is not required for the POC.

Recommended message model:

```ts
type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}
```

The UI only needs to render `user` and `assistant` messages. A `system` role can be useful later for local debug messages, but it is optional.

### LLM Route

Create a server route:

```txt
POST /api/chat
```

Request shape:

```ts
type DiagramChatRequest = {
  question: string
  diagram: DiagramContext
  recentMessages?: {
    role: 'user' | 'assistant'
    content: string
  }[]
}
```

Response shape:

```ts
type DiagramChatResponse = {
  answer: string
}
```

The route should:

1. validate that `question` exists
2. validate that `diagram` has the expected shape
3. read `OPENROUTER_API_KEY` from the environment
4. build a focused prompt
5. call OpenRouter
6. return the assistant answer

Invalid requests should return `400`. Missing API key should return `500` with a safe message that does not expose secrets.

## Prompt Strategy

The first prompt should be direct and conservative. Use a system message for behavior and a user message for the actual question and diagram payload.

System message:

```txt
You are DiagramTalk, an assistant that helps reason about diagrams.

The user is working in a tldraw diagram and asked a question.
You receive normalized diagram context: selected shapes, all current-page shapes, arrow bindings, and derived connections.
Use selectedShapes and selectedConnections first, then the wider shapes and connections if needed.
Treat connections as arrow relationships where startShapeId is the arrow start and endShapeId is the arrow end.
Use arrowheadStart and arrowheadEnd to reason about directionality.
If the context is insufficient, say what additional diagram information would help.
Be concise, practical, and explicit about uncertainty.
Do not claim to see diagram elements that are not present in the provided context.
Do not suggest canvas edits unless the user asks for edits.
```

User message:

```txt
User question:
{question}

Diagram context:
{diagramJson}
```

The model should receive compact JSON. Pretty-printed JSON is acceptable for debugging during the POC.

## OpenRouter Request

Use OpenRouter's chat completions API from the server route.

The POC can use one default model. If `OPENROUTER_MODEL` is set, use it. Otherwise use a conservative default in code.

Recommended configuration:

```ts
const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4.5'
```

If that model is not available in the user's OpenRouter account, the environment variable can override it without code changes.

Response handling should extract the first assistant message's text. If the provider response is malformed, return a clear API error.

## Suggested File Structure

```txt
app/
  api/
    chat/
      route.ts
  layout.tsx
  page.tsx
components/
  DiagramWorkspace.tsx
  ChatPanel.tsx
  SelectionSummary.tsx
lib/
  diagramContext.ts
  openrouter.ts
  types.ts
```

Optional if the CSS grows:

```txt
app/
  globals.css
```

## Component Responsibilities

### `DiagramWorkspace`

Owns the overall workspace layout.

Responsibilities:

- render the tldraw editor
- keep a reference to the tldraw editor instance
- track selected shape IDs, selected shape records, current-page shapes, arrow bindings, and derived connections
- pass diagram context into the chat panel

Implementation notes:

- this must be a client component
- import `Tldraw` from `tldraw`
- import `tldraw/tldraw.css`
- use `onMount` to capture the editor instance
- subscribe to selection changes after the editor mounts
- clean up subscriptions if the tldraw API returns unsubscribe functions

### `ChatPanel`

Owns the chat interaction.

Responsibilities:

- render conversation messages
- render input form
- submit question and diagram context to `/api/chat`
- show loading and error states

Implementation notes:

- optimistic append the user's message before the API call
- append the assistant response when the call succeeds
- append or display an error when the call fails
- send the last few messages only if conversation context becomes useful
- keep the first version focused: current question plus normalized diagram context is enough

### `SelectionSummary`

Shows a compact view of the current selection.

Responsibilities:

- show "No selection" when nothing is selected
- show selected shape count
- show basic shape type information when available

The summary should not dump raw JSON into the UI. It should be compact and readable.

### `diagramContext`

Contains helper functions for extracting useful context from the tldraw editor.

The implementation should extract the current page and normalize it for the LLM:

```ts
getCurrentDiagramContext(editor) => {
  const shapes = editor.getCurrentPageShapesInReadingOrder()

  return {
    selectedShapeIds: editor.getSelectedShapeIds(),
    selectedShapes: /* selected normalized shapes */,
    selectedConnections: /* connections touching selected shapes or arrows */,
    shapes: shapes.map(toDiagramShapeContext),
    bindings: /* arrow bindings */,
    connections: /* derived arrow connections */,
    summary: /* shape and connection counts */,
  }
}
```

Later, this can expand to nearby labels, page regions, screenshots, and semantic grouping.

Recommended helper:

```ts
function toDiagramShapeContext(shape) {
  return {
    id: shape.id,
    type: shape.type,
    label: /* plaintext rich text label, when available */,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    bounds: /* page bounds */,
    props: shape.props,
  }
}
```

The exact shape type should use tldraw's exported TypeScript types once the app is scaffolded.

### `openrouter`

Contains the server-side OpenRouter call.

Responsibilities:

- hide provider-specific request details from the route handler
- use `OPENROUTER_API_KEY`
- normalize errors
- return plain assistant text

Recommended API:

```ts
type GenerateDiagramAnswerInput = {
  question: string
  diagram: DiagramContext
}

async function generateDiagramAnswer(input: GenerateDiagramAnswerInput): Promise<string>
```

## Environment

Required:

```txt
OPENROUTER_API_KEY=...
```

Optional later:

```txt
OPENROUTER_MODEL=...
```

For the POC, `lib/openrouter.ts` should read `OPENROUTER_MODEL` first and fall back to one conservative default model in code.

Add `.env.local` locally:

```txt
OPENROUTER_API_KEY=your_key_here
OPENROUTER_MODEL=anthropic/claude-sonnet-4.5
```

The `.env.local` file should not be committed.

## Error Handling

Frontend errors:

- show a chat error when `/api/chat` fails
- keep the user's typed question in the chat history even if the answer fails
- allow retry by asking again

Server errors:

- missing question: `400`
- malformed JSON: `400`
- missing API key: `500`
- OpenRouter failure: `502`

The server should log enough detail for local debugging, but the client response should stay simple.

## Privacy and Security

The POC sends selected diagram data to an external LLM provider. This should be explicit in the project notes and future UI if real users are involved.

Rules:

- never expose `OPENROUTER_API_KEY` to the browser
- only send selected shape context initially
- do not send full canvas state until there is a clear reason
- do not store chat or diagram content server-side in the POC

## Non Goals

The POC should not include:

- authentication
- database persistence
- multiplayer
- production deployment
- direct LLM edits to the canvas
- custom tldraw tools
- file import/export
- long-term chat history

These are useful later, but they are distractions before the main interaction is proven.

## Implementation Order

Build in this order:

1. Scaffold the Next.js app.
2. Install tldraw and render the editor.
3. Create a two-pane workspace layout.
4. Add static chat UI.
5. Capture and display selected shape context.
6. Add `/api/chat` with a temporary mock answer.
7. Replace the mock with OpenRouter.
8. Test with a simple diagram containing two boxes and one arrow.

Using a mock answer before OpenRouter helps verify that the UI and selection plumbing work independently from API credentials.

## Milestones

### Milestone 1: App Shell

- create Next.js app structure
- render tldraw full-height
- render right-side chat panel
- verify the canvas works

Done when:

- app starts locally
- tldraw is visible and usable
- chat panel is visible beside the canvas

### Milestone 2: Selection Context

- capture selected shapes from tldraw
- display selection summary in the chat panel
- prepare serializable context for API calls

Done when:

- selecting a shape updates the panel
- deselecting clears the panel
- multiple selected shapes show a useful count and type summary

### Milestone 3: LLM Call

- create `/api/chat`
- call OpenRouter server-side
- display assistant response in chat

Done when:

- submitting a question creates a user message
- assistant answer appears after the API call
- missing API key produces a readable error

### Milestone 4: Better Context

- include connected arrows and related shapes
- improve prompt formatting
- test with real diagrams

Done when:

- selecting an arrow gives the LLM enough context to know what it connects
- answers become specific enough to judge the central product idea

## Validation Criteria

The POC is successful when:

- the user can draw a simple diagram
- the user can select a shape or arrow
- the chat panel knows what is selected
- the user can ask a question about the selection
- the LLM answer refers meaningfully to the selected diagram element

If the LLM answer is generic or confused, the next work should focus on richer context extraction rather than UI polish.

## Known Implementation Notes

- tldraw should run in a client component.
- The tldraw CSS must be imported.
- The OpenRouter API key must never be exposed to the browser.
- The POC may need a tldraw license key before production deployment, but local development is enough for the first milestone.

## Decisions Made for the POC

- Use Next.js App Router.
- Use TypeScript.
- Use tldraw's built-in editor UI.
- Keep chat state in browser memory.
- Send selected shape context first, not the full canvas.
- Keep LLM output text-only.
- Avoid persistence, accounts, collaboration, and direct canvas edits.

## Decisions Still Open

These do not block the first implementation:

- exact OpenRouter default model
- whether to include whole-canvas context after the first prototype
- whether conversations should attach to selected shapes
- whether future LLM suggestions should become proposed canvas edits
- whether diagrams should eventually persist locally, in files, or in a database
