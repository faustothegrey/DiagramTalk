import { addDiagramCommand, listDiagramCommands } from '@/lib/diagramApiStore'
import type {
  CreateDiagramCommandRequest,
  CreateDiagramCommandResponse,
  DiagramCommand,
  DiagramCommandStatus,
  ListDiagramCommandsResponse,
} from '@/lib/diagramApiTypes'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const status = url.searchParams.get('status')

  if (status && !isDiagramCommandStatus(status)) {
    return Response.json({ error: 'Invalid command status.' }, { status: 400 })
  }

  const commandStatus = status && isDiagramCommandStatus(status) ? status : undefined
  const response: ListDiagramCommandsResponse = {
    commands: listDiagramCommands(commandStatus),
  }

  return Response.json(response)
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isCreateDiagramCommandRequest(payload)) {
    return Response.json({ error: 'Invalid diagram command request.' }, { status: 400 })
  }

  const baseCommand = {
    id: crypto.randomUUID(),
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
  }
  const command: DiagramCommand =
    payload.type === 'createShape'
      ? {
          ...baseCommand,
          type: 'createShape',
          input: payload.input,
        }
      : {
          ...baseCommand,
          type: 'createConnection',
          input: payload.input,
        }

  const response: CreateDiagramCommandResponse = {
    command: addDiagramCommand(command),
  }

  return Response.json(response, { status: 201 })
}

function isDiagramCommandStatus(value: string): value is DiagramCommandStatus {
  return value === 'pending' || value === 'applied' || value === 'failed'
}

function isCreateDiagramCommandRequest(
  value: unknown,
): value is CreateDiagramCommandRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<CreateDiagramCommandRequest>

  if (maybeRequest.type === 'createShape') {
    return isCreateShapeInput(maybeRequest.input)
  }

  if (maybeRequest.type === 'createConnection') {
    return isCreateConnectionInput(maybeRequest.input)
  }

  return false
}

function isCreateShapeInput(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>

  return (
    (input.type === 'box' ||
      input.type === 'ellipse' ||
      input.type === 'text' ||
      input.type === 'note') &&
    typeof input.x === 'number' &&
    Number.isFinite(input.x) &&
    typeof input.y === 'number' &&
    Number.isFinite(input.y) &&
    (input.id === undefined || typeof input.id === 'string') &&
    (input.label === undefined || typeof input.label === 'string') &&
    (input.w === undefined || (typeof input.w === 'number' && Number.isFinite(input.w))) &&
    (input.h === undefined || (typeof input.h === 'number' && Number.isFinite(input.h)))
  )
}

function isCreateConnectionInput(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>

  return (
    typeof input.fromShapeId === 'string' &&
    input.fromShapeId.length > 0 &&
    typeof input.toShapeId === 'string' &&
    input.toShapeId.length > 0 &&
    (input.id === undefined || typeof input.id === 'string') &&
    (input.label === undefined || typeof input.label === 'string') &&
    (input.directional === undefined || typeof input.directional === 'boolean')
  )
}
