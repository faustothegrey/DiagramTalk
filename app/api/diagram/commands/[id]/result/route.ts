import { updateDiagramCommandResult } from '@/lib/diagramApiStore'
import type {
  DiagramCommandResultRequest,
  DiagramCommandResultResponse,
} from '@/lib/diagramApiTypes'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isDiagramCommandResultRequest(payload)) {
    return Response.json({ error: 'Invalid command result request.' }, { status: 400 })
  }

  const command = updateDiagramCommandResult(id, payload)

  if (!command) {
    return Response.json({ error: 'Command not found.' }, { status: 404 })
  }

  const response: DiagramCommandResultResponse = { command }

  return Response.json(response)
}

function isDiagramCommandResultRequest(
  value: unknown,
): value is DiagramCommandResultRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<DiagramCommandResultRequest>

  return (
    maybeRequest.status === 'applied' ||
    (maybeRequest.status === 'failed' &&
      'error' in maybeRequest &&
      typeof maybeRequest.error === 'string' &&
      maybeRequest.error.length > 0)
  )
}
