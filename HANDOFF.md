# DiagramTalk Engineering Handoff

Read this first when starting a fresh session. Then read `PROJECT.md` for the
original product brief and `diagramtalk/SKILL.md` for the agent-facing workflow.

Current pushed `main` when this handoff was refreshed: `eaf2128`.

## 1. What This Is

DiagramTalk is a local Next.js + tldraw whiteboard with two first-class users:

- A human who draws, chats with an LLM about the diagram, exports, saves, and
  switches named diagrams.
- An external agent or test driver that controls the canvas through REST and the
  bundled `diagramtalk` Python CLI.

The app normally runs at:

```bash
npm run dev
```

Default URL:

```txt
http://localhost:3000
```

The agent can create shapes, connect elements, clear diagrams, frame the camera,
render images, explicitly save, pulse-highlight elements, move live state tags,
record timed runs, and manage named diagrams.

## 2. Stack

- Next.js App Router, React, TypeScript.
- tldraw `^5.1.1`.
- Playwright e2e suite on `localhost:3001` by default.
- `pdf-lib` for PDF export.
- OpenRouter only for chat/ask. The diagram API, save, render, recording, and
  CLI workflows do not need `OPENROUTER_API_KEY`.

Useful commands:

```bash
npm run dev
npm run typecheck
npm run lint
npm run test:e2e
python3 -m py_compile diagramtalk/scripts/diagramtalk.py
```

## 3. Architecture In One Fact

tldraw only runs in the browser tab. The Next server is a relay and persistence
layer; it cannot directly inspect or mutate the live canvas.

Consequences:

- Mutating API calls enqueue commands in memory.
- `DiagramApiBridge.tsx` runs inside the browser, polls pending commands, applies
  them through the tldraw `Editor`, then reports success/failure.
- No open app tab means commands remain `pending`.
- Render and explicit save are pull-based: the server records a request, the
  browser bridge fulfills it, then the caller polls for completion.
- Diagrams persist to `.diagramtalk/diagrams/`, but command queue, published
  context, render cache, and save request state are in-memory and reset on a
  Next.js restart.

## 4. Important Runtime Semantics

### Data Safety

`.diagramtalk/` is the user's local DiagramTalk data store, not disposable test
output. It contains saved diagrams, the active diagram pointer, recordings, and
legacy migrated snapshots. Never remove it during cleanup.

Safe cleanup targets:

```bash
rm -rf test-results playwright-report
```

Unsafe cleanup target:

```bash
rm -rf .diagramtalk
```

This exact mistake previously deleted the user's saved diagrams. Recovery was
possible only because Time Machine had a recent backup. If test runs create
unwanted Playwright diagrams inside `.diagramtalk`, remove those specific
diagram records only after inspecting them, or leave them for the user.

### Autosave

The browser bridge autosaves the active diagram snapshot after canvas changes by
posting to `/api/diagram/snapshot`.

Snapshot shape data is under:

```txt
snapshot.document.store["shape:*"]
```

Do not count a top-level `snapshot.store`; that is the wrong shape location for
current snapshots.

### Recording Freeze

When a recording is active for a diagram, base diagram persistence is frozen:

- Autosave snapshot posts return `409`.
- Explicit `POST /api/diagram/save` returns `409`.
- Run-time visual events still persist to the recording.

This is deliberate. A recording is a run log over a stable base diagram. During
a run, drivers should use `highlight` and `setStateTag`; after the run, end the
recording before making structural edits that should become the saved baseline.

### Recordings

Recordings persist under:

```txt
.diagramtalk/recordings/
.diagramtalk/recordings-index.json
```

Only one recording is active at a time. Starting a new one closes any previous
open recording. Recorded events are appended when `highlight` or `setStateTag`
commands are enqueued for the recording's diagram. This is intentionally
enqueue-time capture: recordings represent external-driver intent and remain
complete even if `endRecording` arrives before the browser bridge has applied
the trailing visual commands.

External drivers should prefer the first-class diagram command forms:

```json
{ "type": "startRecording", "diagramId": "<id>", "input": { "name": "run" } }
{ "type": "endRecording", "diagramId": "<id>" }
```

These are sent to `POST /api/diagram/commands`, are applied immediately by the
server, do not require an open browser tab, and return
`command.result.recordingId`. The older `/api/diagram/recordings` start/end
endpoints remain available for compatibility.

Each event stores:

- `commandId`
- `type`
- original `input`
- `occurredAt`
- `elapsedMs`

Playback/replay is not implemented yet.

### State Tags

State tags are live overlays rendered above tldraw, not shapes. They are meant
for state-machine diagrams where an external app/test runner wants to show the
agent's current state.

Rules:

- Command type: `setStateTag`.
- Target must be a box/rectangle shape.
- Reusing the same `tagId` moves that tag.
- Tags do not mutate snapshots or renders.

### Highlights

Highlights are also live overlays, not tldraw highlighter shapes. They pulse
around existing shape ids and do not change snapshots or renders.

Connections are arrow shapes, so use `connection.arrowId` from
`/api/diagram/context` when highlighting an edge.

## 5. Directory Map

```txt
app/
  page.tsx
  api/
    chat/route.ts
    diagrams/route.ts
    diagrams/[id]/route.ts
    diagram/
      context/route.ts
      snapshot/route.ts
      commands/route.ts
      commands/[id]/result/route.ts
      render/route.ts
      save/route.ts
      recordings/route.ts
      recordings/[id]/route.ts
      ask/route.ts

components/
  DiagramWorkspace.tsx
  DiagramApiBridge.tsx
  DiagramCanvasOverlay.tsx
  DiagramHighlightOverlay.tsx
  DiagramStateTagOverlay.tsx
  DiagramSwitcher.tsx
  ChatPanel.tsx
  SelectionSummary.tsx

lib/
  diagramApiTypes.ts
  diagramStore.ts
  diagramApiStore.ts
  diagramRenderStore.ts
  diagramSaveStore.ts
  diagramRecordingStore.ts
  diagramContext.ts
  diagramExport.ts
  diagramHighlight.ts
  diagramStateTags.ts
  openrouter.ts
  types.ts

diagramtalk/
  SKILL.md
  PRINCIPLES.md
  LIMITATIONS.md
  references/api.md
  scripts/diagramtalk.py
  examples/consensus-protocol.json

tests/e2e/diagram-api.spec.ts
playwright.config.ts
```

## 6. Main API Surface

Base URL:

```txt
http://localhost:3000
```

Diagrams:

- `GET /api/diagrams`
- `POST /api/diagrams`
- `GET /api/diagrams/{id}`
- `PATCH /api/diagrams/{id}`
- `DELETE /api/diagrams/{id}`

Context and snapshots:

- `GET /api/diagram/context`
- `POST /api/diagram/context`
- `GET /api/diagram/snapshot`
- `POST /api/diagram/snapshot`

Commands:

- `POST /api/diagram/commands`
- `GET /api/diagram/commands?status=pending|applied|failed`
- `POST /api/diagram/commands/{id}/result`

Supported command types:

- `createShape`
- `createConnection`
- `clearDiagram`
- `setCamera`
- `highlight`
- `setStateTag`

Any command may include `diagramId`. If present, the open browser tab
auto-activates that diagram before applying the command.

Render and save:

- `POST /api/diagram/render`
- `GET /api/diagram/render?id=<id>&meta=1`
- `GET /api/diagram/render?id=<id>`
- `PUT /api/diagram/render`
- `POST /api/diagram/save`
- `GET /api/diagram/save?id=<id>`

Recording:

- `POST /api/diagram/commands` with `type: "startRecording"`
- `POST /api/diagram/commands` with `type: "endRecording"`
- `GET /api/diagram/recordings`
- `POST /api/diagram/recordings`
- `GET /api/diagram/recordings/{id}`
- `GET /api/diagram/recordings/active`
- `PATCH /api/diagram/recordings/{id}`
- `PATCH /api/diagram/recordings/active`

LLM:

- `POST /api/diagram/ask`
- `POST /api/chat`

Full details and payload examples are in `diagramtalk/references/api.md`.

## 7. CLI

Use:

```bash
python3 diagramtalk/scripts/diagramtalk.py <verb>
```

Set `DIAGRAMTALK_URL` if the app is not on `localhost:3000`.

Verbs:

```txt
context
snapshot
diagrams
new
use
rename
delete
commands
clear
camera
highlight
tag
record
save
render
shape
connect
layout
ask
wait
```

Common recording flow:

```bash
python3 diagramtalk/scripts/diagramtalk.py record start --name "Agent run" --diagram <id>
python3 diagramtalk/scripts/diagramtalk.py highlight shape:waiting --color yellow
python3 diagramtalk/scripts/diagramtalk.py tag shape:waiting agent --tag-id agent-1
python3 diagramtalk/scripts/diagramtalk.py tag shape:done agent --tag-id agent-1
python3 diagramtalk/scripts/diagramtalk.py record end
python3 diagramtalk/scripts/diagramtalk.py record show <recording-id>
```

## 8. Layout Discipline

The `diagramtalk` skill is built around this principle:

```txt
Verify geometry, don't infer it.
```

For anything larger than a tiny edit, use `diagramtalk/scripts/diagramtalk.py
layout` with a JSON spec and run `--dry-run` first. The dry run reports:

- `overlaps`
- `arrowCrossings`

Do not post generated diagrams until overlaps are empty and every remaining
arrow crossing is either removed or consciously accepted. Read
`diagramtalk/PRINCIPLES.md` before doing serious diagram generation.

## 9. UI Notes

- The tldraw style panel is disabled.
- The chat/sidebar can resize all the way to `0px`; the resize handle remains
  visible.
- The Commands tab contains a concise Automation note with CLI examples.
- `DiagramCanvasOverlay` mounts both highlight and state-tag overlays in front
  of the canvas.

## 10. Test Coverage

The Playwright suite covers:

- Browser bridge shape and connection creation.
- Targeted diagram auto-activation via `diagramId`.
- Explicit save persistence.
- PNG/SVG render export.
- Camera movement.
- Transient highlight behavior and missing-id failure.
- State tags moving between box states and staying out of snapshots.
- Recording highlight/state-tag events with timestamps.
- Recording freeze: save is rejected during recording, and live-only structural
  changes do not enter the persisted snapshot while recording is active.

Run:

```bash
npm run test:e2e
```

The suite starts its own server on `localhost:3001`. If another Next dev server
from the same checkout is registered, Playwright may fail to start; stop the old
server and rerun.

Latest verification before this handoff:

```txt
npm run typecheck
npm run lint
python3 -m py_compile diagramtalk/scripts/diagramtalk.py
npm run test:e2e
```

All passed after commit `eaf2128`.

## 11. Recent Feature History

Newest first:

- `eaf2128` Freeze diagram persistence during recordings.
- `2682688` Merge state tags and recording facility.
- `de626a7` Allow sidebar to fully collapse.
- `6020867` Add state tags and recording facility.
- `e13ab61` Update Next dev route type reference.
- `2a527ce` Document highlight and e2e workflows.
- `f603f47` Add transient diagram highlighting and e2e tests.
- `4caca99` Add engineering handoff.
- `9a1e87f` Add explicit Save UI/API/CLI.
- `2261d83` Add `setCamera` command and CLI.
- `3761e19` Add orthogonal/elbow routing.
- `b4ce34b` Add clear/replace, render endpoint, and target-any-diagram support.
- `786da35` Hide tldraw style panel and add resizable chat sidebar.
- `79cae24` / `ad6c582` Add multiple named diagrams and skill docs.

## 12. Known Open Items

- Playback/replay from recordings is not implemented.
- Render exports content bounds, not the current viewport/camera framing.
- Layout engine still lacks a proper 2D/snake placement mode and self-loop edge
  support; see `diagramtalk/LIMITATIONS.md`.
- `next-env.d.ts` and `tsconfig.tsbuildinfo` can change during Next/TS runs.
  Avoid committing generated metadata churn unless it is intentional.

## 13. Working Norms

- Prefer worktrees for substantial changes so an active dev server is not
  disturbed.
- Use `rg` for searches.
- Use `apply_patch` for manual edits.
- Do not commit `.diagramtalk/`, `.diagramtalk.*`, `test-results/`, or
  `playwright-report/`.
- Never delete `.diagramtalk/` as cleanup. It is user data, even though it is
  git-ignored.
- Commit and push only when asked.
- After API/CLI behavior changes, update both `diagramtalk/SKILL.md` and
  `diagramtalk/references/api.md`.
- For browser-bridge behavior, run `npm run test:e2e`; static checks alone are
  not enough.
