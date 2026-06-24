import { createDiagram, listDiagrams } from '@/lib/diagramStore'
import type {
  CreateDiagramRequest,
  DiagramRecordResponse,
  ListDiagramsResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const response: ListDiagramsResponse = await listDiagrams()
    return Response.json(response)
  } catch (error) {
    console.error('[api/diagrams]', error)
    return Response.json({ error: 'Unable to list diagrams.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let payload: unknown = {}

  try {
    const text = await request.text()
    payload = text ? JSON.parse(text) : {}
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isCreateDiagramRequest(payload)) {
    return Response.json({ error: 'Invalid create diagram request.' }, { status: 400 })
  }

  try {
    const diagram = await createDiagram({ name: payload.name })
    const response: DiagramRecordResponse = { diagram, activeId: diagram.id }
    return Response.json(response, { status: 201 })
  } catch (error) {
    console.error('[api/diagrams]', error)
    return Response.json({ error: 'Unable to create diagram.' }, { status: 500 })
  }
}

function isCreateDiagramRequest(value: unknown): value is CreateDiagramRequest {
  if (!value || typeof value !== 'object') return false
  const name = (value as Partial<CreateDiagramRequest>).name
  return name === undefined || name === null || typeof name === 'string'
}
