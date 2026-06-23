import { getPublishedDiagramContext } from '@/lib/diagramApiStore'
import { generateDiagramAnswer } from '@/lib/openrouter'
import type { AskDiagramRequest, AskDiagramResponse } from '@/lib/diagramApiTypes'

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isAskDiagramRequest(payload)) {
    return Response.json({ error: 'Invalid ask request.' }, { status: 400 })
  }

  const { context, updatedAt } = getPublishedDiagramContext()

  if (!context) {
    return Response.json({ error: 'No diagram context has been published yet.' }, { status: 409 })
  }

  try {
    const answer = await generateDiagramAnswer({
      question: payload.question.trim(),
      diagram: context,
    })

    const response: AskDiagramResponse = {
      answer,
      contextUpdatedAt: updatedAt,
    }

    return Response.json(response)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate answer.'
    const status = message.includes('OPENROUTER_API_KEY') ? 500 : 502

    console.error('[api/diagram/ask]', error)

    return Response.json({ error: message }, { status })
  }
}

function isAskDiagramRequest(value: unknown): value is AskDiagramRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<AskDiagramRequest>

  return typeof maybeRequest.question === 'string' && maybeRequest.question.trim().length > 0
}
