import { generateDiagramAnswer } from '@/lib/openrouter'
import type { DiagramChatRequest, DiagramChatResponse } from '@/lib/types'

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isDiagramChatRequest(payload)) {
    return Response.json({ error: 'Invalid chat request.' }, { status: 400 })
  }

  try {
    const answer = await generateDiagramAnswer({
      question: payload.question.trim(),
      diagram: payload.diagram,
    })

    const response: DiagramChatResponse = { answer }

    return Response.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate answer.'
    const status = message.includes('OPENROUTER_API_KEY') ? 500 : 502

    console.error('[api/chat]', error)

    return Response.json({ error: message }, { status })
  }
}

function isDiagramChatRequest(value: unknown): value is DiagramChatRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<DiagramChatRequest>

  return (
    typeof maybeRequest.question === 'string' &&
    maybeRequest.question.trim().length > 0 &&
    !!maybeRequest.diagram &&
    Array.isArray(maybeRequest.diagram.selectedShapeIds) &&
    Array.isArray(maybeRequest.diagram.selectedShapes) &&
    Array.isArray(maybeRequest.diagram.shapes) &&
    Array.isArray(maybeRequest.diagram.bindings) &&
    Array.isArray(maybeRequest.diagram.connections)
  )
}
