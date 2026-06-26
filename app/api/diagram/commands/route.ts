import { addDiagramCommand, listDiagramCommands } from '@/lib/diagramApiStore'
import { getActiveDiagram, getDiagram } from '@/lib/diagramStore'
import {
  endRecording,
  appendRecordingEvent,
  getActiveRecording,
  getActiveRecordingForDiagram,
  getRecording,
  listRecordings,
  startRecording,
} from '@/lib/diagramRecordingStore'
import type {
  CreateDiagramCommandRequest,
  CreateDiagramCommandResponse,
  DiagramCommand,
  DiagramCommandStatus,
  EndRecordingInput,
  HighlightCommand,
  ListDiagramCommandsResponse,
  SetStateTagCommand,
  StartRecordingInput,
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

  if (payload.type === 'startRecording') {
    return createStartRecordingCommand(payload)
  }

  if (payload.type === 'endRecording') {
    return createEndRecordingCommand(payload)
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
  } else if (payload.type === 'setCamera') {
    command = { ...baseCommand, type: 'setCamera', input: payload.input }
  } else if (payload.type === 'highlight') {
    command = { ...baseCommand, type: 'highlight', input: payload.input }
  } else if (payload.type === 'setStateTag') {
    command = { ...baseCommand, type: 'setStateTag', input: payload.input }
  } else {
    command = { ...baseCommand, type: 'clearDiagram' }
  }

  const addedCommand = addDiagramCommand(command)
  await recordEnqueuedCommand(addedCommand)

  const response: CreateDiagramCommandResponse = {
    command: addedCommand,
  }

  return Response.json(response, { status: 201 })
}

async function recordEnqueuedCommand(command: DiagramCommand) {
  if (!isRecordableCommand(command)) return

  const diagramId = command.diagramId ?? (await getActiveDiagram())?.id ?? null
  if (!diagramId) return

  await appendRecordingEvent({
    diagramId,
    commandId: command.id,
    type: command.type,
    input: command.input,
    occurredAt: command.createdAt,
  })
}

function isRecordableCommand(command: DiagramCommand): command is HighlightCommand | SetStateTagCommand {
  return command.type === 'highlight' || command.type === 'setStateTag'
}

async function createStartRecordingCommand(
  payload: Extract<CreateDiagramCommandRequest, { type: 'startRecording' }>,
) {
  const activeDiagram = payload.diagramId === undefined ? await getActiveDiagram() : null
  const diagramId = payload.diagramId ?? activeDiagram?.id ?? null

  if (!diagramId) {
    return Response.json({ error: 'No diagram to record.' }, { status: 404 })
  }

  const recording = await startRecording({ diagramId, name: payload.input?.name })
  const createdAt = recording.startedAt
  const command: DiagramCommand = {
    id: crypto.randomUUID(),
    status: 'applied',
    createdAt,
    appliedAt: createdAt,
    diagramId,
    type: 'startRecording',
    ...(payload.input !== undefined ? { input: payload.input } : {}),
    result: {
      recordingId: recording.id,
      activeId: recording.id,
    },
  }

  const response: CreateDiagramCommandResponse = {
    command: addDiagramCommand(command),
  }

  return Response.json(response, { status: 201 })
}

async function createEndRecordingCommand(
  payload: Extract<CreateDiagramCommandRequest, { type: 'endRecording' }>,
) {
  const recordingToEnd = await resolveRecordingToEnd(payload.input, payload.diagramId)

  if (!recordingToEnd) {
    return Response.json({ error: 'Recording not found.' }, { status: 404 })
  }

  if (payload.diagramId !== undefined && recordingToEnd.diagramId !== payload.diagramId) {
    return Response.json({ error: 'Recording does not belong to the target diagram.' }, { status: 409 })
  }

  const recording = await endRecording(recordingToEnd.id)

  if (!recording) {
    return Response.json({ error: 'Recording not found.' }, { status: 404 })
  }

  const { activeId } = await listRecordings()
  const createdAt = new Date().toISOString()
  const command: DiagramCommand = {
    id: crypto.randomUUID(),
    status: 'applied',
    createdAt,
    appliedAt: recording.endedAt ?? createdAt,
    diagramId: recording.diagramId,
    type: 'endRecording',
    ...(payload.input !== undefined ? { input: payload.input } : {}),
    result: {
      recordingId: recording.id,
      activeId,
    },
  }

  const response: CreateDiagramCommandResponse = {
    command: addDiagramCommand(command),
  }

  return Response.json(response, { status: 201 })
}

async function resolveRecordingToEnd(input?: EndRecordingInput, diagramId?: string) {
  if (input?.id) return getRecording(input.id)
  if (diagramId) return getActiveRecordingForDiagram(diagramId)
  return getActiveRecording()
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

  if (maybeRequest.type === 'setCamera') {
    return isSetCameraInput((maybeRequest as { input?: unknown }).input)
  }

  if (maybeRequest.type === 'highlight') {
    return isHighlightInput((maybeRequest as { input?: unknown }).input)
  }

  if (maybeRequest.type === 'setStateTag') {
    return isSetStateTagInput((maybeRequest as { input?: unknown }).input)
  }

  if (maybeRequest.type === 'startRecording') {
    return isOptionalStartRecordingInput((maybeRequest as { input?: unknown }).input)
  }

  if (maybeRequest.type === 'endRecording') {
    return isOptionalEndRecordingInput((maybeRequest as { input?: unknown }).input)
  }

  return false
}

function isSetCameraInput(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  const isFiniteNumber = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const isOptionalNumber = (v: unknown) => v === undefined || isFiniteNumber(v)

  if (input.mode === 'fit') {
    return isOptionalNumber(input.padding)
  }
  if (input.mode === 'topLeft') {
    return isOptionalNumber(input.margin) && isOptionalNumber(input.zoom)
  }
  if (input.mode === 'absolute') {
    return isFiniteNumber(input.x) && isFiniteNumber(input.y) && isFiniteNumber(input.zoom)
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
const CONNECTION_ROUTINGS = new Set(['straight', 'orthogonal'])
const HIGHLIGHT_COLORS = new Set(['yellow', 'blue', 'green', 'red', 'violet'])
const STATE_TAG_COLORS = new Set(['blue', 'green', 'yellow', 'red', 'violet', 'grey'])

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
    isOptionalEnum(input.color, SHAPE_COLORS) &&
    isOptionalEnum(input.routing, CONNECTION_ROUTINGS)
  )
}

function isHighlightInput(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  const isNumberInRange = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

  return (
    Array.isArray(input.ids) &&
    input.ids.length > 0 &&
    input.ids.every((id) => typeof id === 'string' && id.length > 0) &&
    isOptionalEnum(input.color, HIGHLIGHT_COLORS) &&
    (input.durationMs === undefined || isNumberInRange(input.durationMs, 100, 10000)) &&
    (input.padding === undefined || isNumberInRange(input.padding, 0, 80))
  )
}

function isSetStateTagInput(value: unknown) {
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  const hasOptionalTagId = input.tagId === undefined || typeof input.tagId === 'string'
  const hasOptionalShapeId = input.shapeId === undefined || typeof input.shapeId === 'string'
  const hasOptionalLabel = input.label === undefined || typeof input.label === 'string'
  const hasOptionalClear = input.clear === undefined || typeof input.clear === 'boolean'

  if (!hasOptionalTagId || !hasOptionalShapeId || !hasOptionalLabel || !hasOptionalClear) {
    return false
  }

  if (!isOptionalEnum(input.color, STATE_TAG_COLORS)) {
    return false
  }

  if (input.clear === true) {
    return true
  }

  return (
    typeof input.shapeId === 'string' &&
    input.shapeId.length > 0 &&
    typeof input.label === 'string' &&
    input.label.trim().length > 0
  )
}

function isOptionalStartRecordingInput(value: unknown): value is StartRecordingInput | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  return input.name === undefined || input.name === null || typeof input.name === 'string'
}

function isOptionalEndRecordingInput(value: unknown): value is EndRecordingInput | undefined {
  if (value === undefined) return true
  if (!value || typeof value !== 'object') return false

  const input = value as Record<string, unknown>
  return input.id === undefined || typeof input.id === 'string'
}
