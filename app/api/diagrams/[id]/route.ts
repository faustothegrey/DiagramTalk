import {
  deleteDiagram,
  getDiagram,
  listDiagrams,
  updateDiagram,
} from '@/lib/diagramStore'
import type {
  DeleteDiagramResponse,
  DiagramRecordResponse,
  UpdateDiagramRequest,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{ id: string }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params

  try {
    const diagram = await getDiagram(id)
    if (!diagram) {
      return Response.json({ error: 'Diagram not found.' }, { status: 404 })
    }

    const { activeId } = await listDiagrams()
    const response: DiagramRecordResponse = { diagram, activeId }
    return Response.json(response)
  } catch (error) {
    console.error('[api/diagrams/[id]]', error)
    return Response.json({ error: 'Unable to read diagram.' }, { status: 500 })
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isUpdateDiagramRequest(payload)) {
    return Response.json({ error: 'Invalid update diagram request.' }, { status: 400 })
  }

  try {
    const diagram = await updateDiagram(id, {
      name: payload.name,
      snapshot: payload.snapshot,
      active: payload.active,
    })

    if (!diagram) {
      return Response.json({ error: 'Diagram not found.' }, { status: 404 })
    }

    const { activeId } = await listDiagrams()
    const response: DiagramRecordResponse = { diagram, activeId }
    return Response.json(response)
  } catch (error) {
    console.error('[api/diagrams/[id]]', error)
    return Response.json({ error: 'Unable to update diagram.' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params

  try {
    const result = await deleteDiagram(id)
    if (!result.deleted) {
      return Response.json({ error: 'Diagram not found.' }, { status: 404 })
    }

    const response: DeleteDiagramResponse = result
    return Response.json(response)
  } catch (error) {
    console.error('[api/diagrams/[id]]', error)
    return Response.json({ error: 'Unable to delete diagram.' }, { status: 500 })
  }
}

function isUpdateDiagramRequest(value: unknown): value is UpdateDiagramRequest {
  if (!value || typeof value !== 'object') return false

  const request = value as Partial<UpdateDiagramRequest>

  if (request.name !== undefined && request.name !== null && typeof request.name !== 'string') {
    return false
  }
  if (request.snapshot !== undefined && (!request.snapshot || typeof request.snapshot !== 'object')) {
    return false
  }
  if (request.active !== undefined && typeof request.active !== 'boolean') {
    return false
  }

  return request.name !== undefined || request.snapshot !== undefined || request.active !== undefined
}
