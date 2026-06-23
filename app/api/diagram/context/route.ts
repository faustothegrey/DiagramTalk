import {
  getPublishedDiagramContext,
  publishDiagramContext,
} from '@/lib/diagramApiStore'
import type {
  GetDiagramContextResponse,
  PublishDiagramContextRequest,
  PublishDiagramContextResponse,
} from '@/lib/diagramApiTypes'

export async function GET() {
  const response: GetDiagramContextResponse = getPublishedDiagramContext()

  return Response.json(response)
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isPublishDiagramContextRequest(payload)) {
    return Response.json({ error: 'Invalid diagram context request.' }, { status: 400 })
  }

  const updatedAt = publishDiagramContext(payload.context)
  const response: PublishDiagramContextResponse = { ok: true, updatedAt }

  return Response.json(response)
}

function isPublishDiagramContextRequest(
  value: unknown,
): value is PublishDiagramContextRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<PublishDiagramContextRequest>
  const context = maybeRequest.context

  return (
    !!context &&
    Array.isArray(context.selectedShapeIds) &&
    Array.isArray(context.selectedShapes) &&
    Array.isArray(context.selectedConnections) &&
    Array.isArray(context.shapes) &&
    Array.isArray(context.bindings) &&
    Array.isArray(context.connections) &&
    !!context.summary &&
    typeof context.summary.shapeCount === 'number' &&
    typeof context.summary.connectionCount === 'number'
  )
}
