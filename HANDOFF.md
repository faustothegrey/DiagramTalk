# DiagramTalk — Engineering Handoff

A working handoff for an agent picking up this project. Read this first, then
`PROJECT.md` (original product brief) and `diagramtalk/SKILL.md` (the agent-facing
skill). Current `main` head when written: `9a1e87f`.

---

## 1. What this is

DiagramTalk is a Next.js + **tldraw** whiteboard where (a) a human draws and chats
with an LLM about the diagram, and (b) an **external agent** can drive the canvas
programmatically through a local HTTP API and a Python CLI (the `diagramtalk`
skill). It runs locally at `http://localhost:3000`.

Two clients of the same app:
- **Human**: draws on the canvas, uses the chat panel, switches/saves diagrams.
- **Agent** (e.g. Codex/Claude via the skill): posts commands to create shapes,
  connect them, clear, frame the camera, render to an image, save,
  pulse-highlight existing elements, and manage multiple diagrams — all over REST.

## 2. Stack & how to run

- Next.js `^16` (App Router), React `^19`, TypeScript, **tldraw `^5.1.1`**,
  `pdf-lib` (PDF export). LLM via OpenRouter.
- Scripts: `npm run dev`, `npm run build`, `npm run typecheck` (`tsc --noEmit`),
  `npm run lint` (`eslint .`), `npm run test:e2e` (Playwright/Chromium on
  `localhost:3001` by default).
- Env: copy `.env.example` → `.env`; set `OPENROUTER_API_KEY` (used by chat/ask
  only — the diagram command/render/save APIs do **not** need it).
- CLI: `python3 diagramtalk/scripts/diagramtalk.py <verb>` (stdlib only, no deps).
  Override base URL with `DIAGRAMTALK_URL`.

## 3. The one architectural fact that explains everything

**tldraw only runs in the browser tab.** The Next server is a relay/store — it has
no tldraw and cannot read or mutate the live canvas. So:

- Mutations (createShape, clearDiagram, setCamera, …) are **queued** on the server
  and **applied by the browser bridge** (`DiagramApiBridge.tsx`) which polls the
  queue and calls the tldraw `Editor`. **No open tab ⇒ commands sit `pending`.**
- Anything that needs the live canvas (render an image, save the current canvas)
  is **pull-based**: the caller registers a request; the bridge polls, fulfills it
  (export / flush snapshot), and writes the result/timestamp back. The CLI then
  polls for completion. This same pattern is used by **render** and **save**.
- The agent has no direct view of the canvas; it "sees" via `render` (image) and
  `context` (structured JSON). The live *viewport* (camera) is only visible to a
  human — `render` exports content bounds, not the viewport (see §7).

## 4. Directory map

```
app/
  page.tsx                         -> <DiagramWorkspace/>
  api/
    chat/route.ts                  POST: LLM chat (OpenRouter) for the chat panel
    diagram/
      context/route.ts             GET/POST: latest normalized canvas context (in-memory)
      snapshot/route.ts            GET/POST: active diagram's tldraw snapshot (autosave target)
      commands/route.ts            GET/POST: queue of mutation commands
      commands/[id]/result/route.ts POST: bridge reports applied/failed
      render/route.ts              POST request / PUT upload / GET bytes|meta (pull-based)
      save/route.ts                POST request / GET status (pull-based)
      ask/route.ts                 POST: LLM Q&A about server-known context
    diagrams/route.ts              GET list+activeId / POST create
    diagrams/[id]/route.ts         GET / PATCH (rename|snapshot|active) / DELETE
components/
  DiagramWorkspace.tsx             Top-level orchestrator: diagram list/active state,
                                   load/switch/create/delete, resizable panel, Save handler.
                                   Mounts <Tldraw key={activeId} components={{StylePanel:null}}>.
  DiagramApiBridge.tsx             THE BRIDGE. Runs inside tldraw. Polls commands/render/save,
                                   applies them via Editor, autosaves snapshot + publishes context.
  DiagramHighlightOverlay.tsx      Transient in-front-of-canvas pulse overlay for highlight commands.
  DiagramSwitcher.tsx              Top bar: diagram dropdown + Save / + New / Delete buttons.
  ChatPanel.tsx                    Chat tab + Commands tab (name, PDF/SVG export).
  SelectionSummary.tsx            Selection readout in the chat panel.
lib/
  diagramApiTypes.ts               ALL wire types (commands, requests, responses). Client-safe.
  diagramStore.ts                  Per-diagram persistence: .diagramtalk/diagrams/<id>.json + index.json
  diagramApiStore.ts               In-memory: published context + command queue (global, resets on restart)
  diagramRenderStore.ts            In-memory: render request + cached renders
  diagramSaveStore.ts              In-memory: save request + savedAt timestamps
  diagramContext.ts                Builds normalized DiagramContext from the tldraw editor
  diagramExport.ts                 Client-side PDF/SVG export (editor.toImage / getSvgString)
  diagramHighlight.ts              Shared event name/types for transient highlight pulses.
  openrouter.ts, types.ts          LLM client + shared chat/context types
diagramtalk/                       The skill (consumed by an external agent)
  SKILL.md                         Workflow + operations (the entry point for the agent)
  PRINCIPLES.md                    "Verify geometry, don't infer it" — the linchpin
  LIMITATIONS.md                   Known bridge/engine limits + deferred work
  references/api.md                Full HTTP API reference
  scripts/diagramtalk.py           The CLI + layout engine (compute_layout, find_overlaps,
                                   find_arrow_crossings)
  examples/consensus-protocol.json A real 26-node / 20-edge layout spec
```

## 5. HTTP API surface (all under `http://localhost:3000`)

- `GET  /api/diagram/context` — latest canvas context (shapes/connections/summary).
- `GET/POST /api/diagram/snapshot` — read/write the **active** diagram's tldraw
  snapshot. POST body `{ id?, snapshot?, name? }`; the bridge autosaves here.
- `POST /api/diagram/commands` — queue a command. Body `{ type, input?, diagramId? }`:
  - `createShape`  `{ type:'box'|'ellipse'|'text'|'note', x, y, w?, h?, label?, color?, fill? }`
  - `createConnection` `{ fromShapeId, toShapeId, label?, directional?, fromAnchor?, toAnchor?, color?, routing?:'straight'|'orthogonal' }`
  - `clearDiagram`  (deletes all shapes on the page)
  - `setCamera`     `{ mode:'fit', padding? } | { mode:'topLeft', margin?, zoom? } | { mode:'absolute', x, y, zoom } }` (view-only)
  - `highlight`     `{ ids:string[], color?:'yellow'|'blue'|'green'|'red'|'violet', durationMs?, padding? }` (view-only transient pulse)
  - Optional `diagramId` targets a non-active diagram (validated; **auto-activate** — the open tab switches to it, applies, saves).
- `GET  /api/diagram/commands?status=pending|applied|failed` — list queue.
- `POST /api/diagram/commands/[id]/result` — bridge reports outcome.
- `POST/GET /api/diagram/render` — request a render / fetch bytes; `GET ?id=&meta=1`
  for status. `PUT` is the bridge upload. Formats png|svg.
- `POST/GET /api/diagram/save` — request a save / poll `{ id, savedAt, request }`.
- `GET  /api/diagrams` — `{ activeId, diagrams[] }`.
- `POST /api/diagrams` — create (becomes active).
- `GET/PATCH/DELETE /api/diagrams/[id]` — get / rename·snapshot·`{active:true}` / delete.
- `POST /api/diagram/ask` — LLM answer about the latest context.

## 6. CLI verbs (`diagramtalk.py`)

`context · snapshot · diagrams · new · use · rename · delete · commands · clear ·
camera · highlight · save · render · shape · connect · layout · ask · wait`

Most mutating verbs accept `--diagram <id>` (auto-activate). `layout <spec>` runs
the collision-checked layout engine; `--dry-run` previews `overlaps` +
`arrowCrossings`, `--post` queues it, `--replace` clears first. `render --out f`,
`save`, `highlight`, and `camera --fit|--top-left|--x --y --zoom` need an open tab.

## 7. Conventions & gotchas (learned the hard way — read these)

- **Snapshot shape lives under `document.store`.** `getSnapshot(editor.store)`
  returns `{ document, session }`; shapes are `document.store["shape:*"]`, NOT a
  top-level `store`. Counting top-level `store` gives 0 and will mislead you.
- **The bridge only runs in an open tab.** Without one: commands stay `pending`,
  `render`/`save` time out. Many "bugs" are just "no tab open / stale tab".
- **Auto-activate is single-shot per bridge instance** (`requestedActivationRef`).
  Don't reintroduce a per-poll `onRequestActivate` call — it caused a switch storm
  (multiple concurrent diagram switches) that exposed the next bug.
- **Atomic writes need unique temp names.** `diagramStore.writeJsonAtomically`
  uses `randomUUID()` in the temp filename; `pid.timestamp` collided under
  concurrent same-file writes → `rename` ENOENT → 500.
- **In-memory vs persisted.** Diagrams persist to `.diagramtalk/` (gitignored).
  Context, command queue, render cache, save state are **in-memory and reset on
  Next.js restart**. The command queue is **global**, applied by whatever tab is
  on the active diagram.
- **Camera is view-only** and never mutates shapes. Math:
  viewport-relative `screen = (page + camera) * z`, so top-left framing is
  `camera = margin/z − pageTopLeft`. (`z` is zoom in tldraw's `{x,y,z}`.)
- **`render` exports the content bounding box, not the viewport.** So camera
  framing is invisible in renders; `render` always shows a tight crop of shapes.
- **tldraw 5.1.1 supports native elbow arrows** (`props.kind:'arc'|'elbow'`). The
  layout engine's `find_arrow_crossings` checks orthogonal edges along their
  routed (elbow) polyline so checker and renderer agree. Orthogonal alone does NOT
  dodge intermediate boxes — pair it with gap-routing anchors (e.g. bottom→bottom).
- **Highlight is not a tldraw highlighter shape.** It is a transient React overlay
  in `InFrontOfTheCanvas`, addressed by real shape ids. It never changes snapshots
  or renders, and it fails if any requested id is missing.

## 8. Feature history (newest first)

- `f603f47` Transient highlight command/API/CLI + Playwright e2e suite.
- `9a1e87f` Explicit Save (UI button + `/api/diagram/save` + CLI `save`).
- `2261d83` `setCamera` view command + `camera` CLI (fit / topLeft / absolute).
- `3761e19` Orthogonal/elbow routing (`routing` on connections; engine routed-path check).
- `b4ce34b` clear/replace, render endpoint, and target-any-diagram (`diagramId`/auto-activate).
- `786da35` Hide tldraw style panel; resizable chat sidebar.
- `79cae24`+`ad6c582` Multiple named diagrams (per-file store + active pointer) and skill docs.
- Earlier: layout engine, color/fill + arrow anchors, arrow-crossing detection,
  the "verify geometry" principle.

## 9. Open items / next steps

- **Task 4 (engine, not started):** 2D / "snake" (alternating-row) placement and
  **self-loop** edges (a state → itself) in `compute_layout`. Tracked in
  `diagramtalk/LIMITATIONS.md`. Ownership was left to the user/agent — confirm before doing.
- **Render-framing nice-to-have:** make `render` optionally reflect the camera
  viewport (e.g. `?mode=topLeft`) so "see" matches "frame". Not done — `render`
  exports shape bounds, so this needs exporting a viewport region (not cheap).
- **Live verification:** Playwright now covers command bridge shape/connection
  creation, targeted diagram auto-activation, explicit save, PNG/SVG render,
  camera movement, and transient highlight behavior. Use `npm run test:e2e`;
  it starts a separate app server on port 3001.
- **Housekeeping:** the remote branch `origin/task3-elbow-routing` is merged but
  not deleted.

## 10. How to work in this repo (norms established with the owner)

- **Don't disturb the running dev server.** The owner usually has `npm run dev`
  live and is *using* it. Do implementation in an isolated **git worktree** with a
  symlinked `node_modules`, e.g.:
  ```bash
  git worktree add /tmp/wt -b my-branch
  ln -s "$PWD/node_modules" /tmp/wt/node_modules   # tsc/eslint without npm install
  ```
  Editing files in the main checkout hot-reloads (disrupts) the owner's session.
- **Verify** with `tsc --noEmit`, `eslint`, `python3 -m py_compile` in the worktree.
  Use `npm run test:e2e` for browser bridge/visual behavior; it runs against a
  separate dev server on port 3001 and should not disturb the owner's port 3000
  session.
- **Commit/push only when asked.** Merging a branch to `main` updates the owner's
  working tree (hot-reload), so do it on request. Keep build churn out
  (`next-env.d.ts` dev/prod path flip; `__pycache__/`).
- **Update docs with code:** any API/CLI change → `diagramtalk/references/api.md`
  + `diagramtalk/SKILL.md`, and report the new signatures so the skill can reload.
- Co-author trailer on commits: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
