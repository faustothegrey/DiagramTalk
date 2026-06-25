import { getActiveDiagram } from '@/lib/diagramStore'
import { getSaveRequest, getSavedAt, requestSave } from '@/lib/diagramSaveStore'
import type {
  RequestSaveResponse,
  SaveMetaResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

// GET ?id=<id> -> save status: the last savedAt for that diagram plus any
// pending request (the bridge polls this to know it should flush now).
export async function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await getActiveDiagram())?.id ?? null

  if (!id) {
    return Response.json({ error: 'No diagram to save.' }, { status: 404 })
  }

  const response: SaveMetaResponse = {
    id,
    savedAt: getSavedAt(id),
    request: getSaveRequest(),
  }
  return Response.json(response)
}

// POST -> request a save of a diagram (defaults to the active one). The bridge
// fulfills it by flushing the live snapshot through POST /api/diagram/snapshot.
export async function POST(request: Request) {
  let payload: unknown = {}
  try {
    const text = await request.text()
    payload = text ? JSON.parse(text) : {}
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const body = (payload ?? {}) as { id?: unknown }
  const id =
    typeof body.id === 'string' && body.id.length > 0
      ? body.id
      : (await getActiveDiagram())?.id ?? null

  if (!id) {
    return Response.json({ error: 'No diagram to save.' }, { status: 404 })
  }

  const created = requestSave(id)
  const response: RequestSaveResponse = { id, requestedAt: created.requestedAt }
  return Response.json(response, { status: 202 })
}
