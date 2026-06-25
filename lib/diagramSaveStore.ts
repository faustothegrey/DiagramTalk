// In-memory coordination for explicit "save now" requests. The live canvas
// lives in the browser, so a save is pull-based (like render): a caller asks
// for a save, the active diagram's bridge flushes its current snapshot through
// POST /api/diagram/snapshot, and that save records `savedAt` here (clearing a
// matching request). State is process-global and resets on a Next.js restart.

type SaveRequest = {
  id: string
  requestedAt: string
}

type SaveState = {
  request: SaveRequest | null
  savedAt: Record<string, string>
}

const globalForSave = globalThis as typeof globalThis & {
  __diagramTalkSaveState?: SaveState
}

const state =
  globalForSave.__diagramTalkSaveState ??
  (globalForSave.__diagramTalkSaveState = {
    request: null,
    savedAt: {},
  })

export function requestSave(id: string): SaveRequest {
  state.request = { id, requestedAt: new Date().toISOString() }
  return state.request
}

export function getSaveRequest(): SaveRequest | null {
  return state.request
}

// Called whenever a diagram's snapshot is persisted. Records the save time and
// clears a pending request for that diagram.
export function markSaved(id: string): string {
  const savedAt = new Date().toISOString()
  state.savedAt[id] = savedAt
  if (state.request?.id === id) {
    state.request = null
  }
  return savedAt
}

export function getSavedAt(id: string): string | null {
  return state.savedAt[id] ?? null
}
