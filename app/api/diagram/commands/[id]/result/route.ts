import { getDiagramCommand, updateDiagramCommandResult } from '@/lib/diagramApiStore'
import { getActiveDiagram } from '@/lib/diagramStore'
import { appendRecordingEvent } from '@/lib/diagramRecordingStore'
import type {
  DiagramCommand,
  DiagramCommandResultRequest,
  DiagramCommandResultResponse,
  HighlightCommand,
  SetStateTagCommand,
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

  const wasPending = getDiagramCommand(id)?.status === 'pending'
  const command = updateDiagramCommandResult(id, payload)

  if (!command) {
    return Response.json({ error: 'Command not found.' }, { status: 404 })
  }

  if (wasPending && payload.status === 'applied') {
    await recordAppliedCommand(command)
  }

  const response: DiagramCommandResultResponse = { command }

  return Response.json(response)
}

async function recordAppliedCommand(command: DiagramCommand) {
  if (!isRecordableCommand(command)) return

  const diagramId = command.diagramId ?? (await getActiveDiagram())?.id ?? null
  if (!diagramId) return

  await appendRecordingEvent({
    diagramId,
    commandId: command.id,
    type: command.type,
    input: command.input,
    occurredAt: command.appliedAt,
  })
}

function isRecordableCommand(command: DiagramCommand): command is HighlightCommand | SetStateTagCommand {
  return command.type === 'highlight' || command.type === 'setStateTag'
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
