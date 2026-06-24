// In-memory store for diagram renders. The browser bridge owns tldraw and is
// the only thing that can rasterize the canvas, so rendering is pull-based:
// a caller requests a render, the active diagram's bridge fulfills it by
// exporting the page and uploading the bytes, and the result is cached here
// per diagram id. State is process-global (like diagramApiStore) and resets on
// a Next.js restart.

export type RenderFormat = 'png' | 'svg'

type StoredRender = {
  format: RenderFormat
  // base64 for png, raw markup for svg.
  data: string
  renderedAt: string
}

type RenderRequest = {
  id: string
  format: RenderFormat
  requestedAt: string
}

type RenderState = {
  renders: Record<string, StoredRender>
  request: RenderRequest | null
}

const globalForRender = globalThis as typeof globalThis & {
  __diagramTalkRenderState?: RenderState
}

const state =
  globalForRender.__diagramTalkRenderState ??
  (globalForRender.__diagramTalkRenderState = {
    renders: {},
    request: null,
  })

export function requestRender(id: string, format: RenderFormat): RenderRequest {
  state.request = { id, format, requestedAt: new Date().toISOString() }
  return state.request
}

export function getRenderRequest(): RenderRequest | null {
  return state.request
}

export function saveRender(id: string, format: RenderFormat, data: string): string {
  const renderedAt = new Date().toISOString()
  state.renders[id] = { format, data, renderedAt }

  // A fulfilled request for this diagram is cleared so the bridge stops re-rendering.
  if (state.request?.id === id) {
    state.request = null
  }

  return renderedAt
}

export function getRender(id: string): StoredRender | null {
  return state.renders[id] ?? null
}
