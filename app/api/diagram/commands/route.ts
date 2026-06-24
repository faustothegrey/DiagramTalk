import { addDiagramCommand, listDiagramCommands } from '@/lib/diagramApiStore'
import { getDiagram } from '@/lib/diagramStore'
import type {
  CreateDiagramCommandRequest,
  CreateDiagramCommandResponse,
  DiagramCommand,
  DiagramCommandStatus,
  ListDiagramCommandsResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

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

  // A command may target a specific diagram. Validate it exists so a typo can't
  // make the browser hop to a non-existent diagram forever.
  if (payload.diagramId !== undefined && !(await getDiagram(payload.diagramId))) {
    return Response.json({ error: 'Target diagram not found.' }, { status: 404 })
  }

  const baseCommand = {
    id: crypto.randomUUID(),
    status: 'pending' as const,
    createdAt: new Date().toISOString(),
    ...(payload.diagramId !== undefined ? { diagramId: payload.diagramId } : {}),
  }
  let command: DiagramCommand
  if (payload.type === 'createShape') {
    command = { ...baseCommand, type: 'createShape', input: payload.input }
  } else if (payload.type === 'createConnection') {
    command = { ...baseCommand, type: 'createConnection', input: payload.input }
  } else {
    command = { ...baseCommand, type: 'clearDiagram' }
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

  if (maybeRequest.diagramId !== undefined && typeof maybeRequest.diagramId !== 'string') {
    return false
  }

  if (maybeRequest.type === 'createShape') {
    return isCreateShapeInput(maybeRequest.input)
  }

  if (maybeRequest.type === 'createConnection') {
    return isCreateConnectionInput(maybeRequest.input)
  }

  if (maybeRequest.type === 'clearDiagram') {
    return true
  }

  return false
}

const SHAPE_COLORS = new Set([
  'black',
  'grey',
  'light-violet',
  'violet',
  'blue',
  'light-blue',
  'yellow',
  'orange',
  'green',
  'light-green',
  'light-red',
  'red',
  'white',
])
const SHAPE_FILLS = new Set(['none', 'semi', 'solid', 'pattern'])
const CONNECTION_ANCHORS = new Set(['top', 'bottom', 'left', 'right', 'center'])

function isOptionalEnum(value: unknown, allowed: Set<string>) {
  return value === undefined || (typeof value === 'string' && allowed.has(value))
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
    (input.h === undefined || (typeof input.h === 'number' && Number.isFinite(input.h))) &&
    isOptionalEnum(input.color, SHAPE_COLORS) &&
    isOptionalEnum(input.fill, SHAPE_FILLS)
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
    (input.directional === undefined || typeof input.directional === 'boolean') &&
    isOptionalEnum(input.fromAnchor, CONNECTION_ANCHORS) &&
    isOptionalEnum(input.toAnchor, CONNECTION_ANCHORS) &&
    isOptionalEnum(input.color, SHAPE_COLORS)
  )
}
