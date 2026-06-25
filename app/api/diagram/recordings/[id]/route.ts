import { endRecording, getRecording, listRecordings } from '@/lib/diagramRecordingStore'
import type {
  EndRecordingRequest,
  RecordingResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params
  const recordingId = await resolveRecordingId(id)

  if (!recordingId) {
    return Response.json({ error: 'Recording not found.' }, { status: 404 })
  }

  const recording = await getRecording(recordingId)

  if (!recording) {
    return Response.json({ error: 'Recording not found.' }, { status: 404 })
  }

  const { activeId } = await listRecordings()
  const response: RecordingResponse = {
    recording,
    activeId,
  }

  return Response.json(response)
}

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params
  let payload: unknown = {}

  try {
    const text = await request.text()
    payload = text ? JSON.parse(text) : {}
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isEndRecordingRequest(payload)) {
    return Response.json({ error: 'Invalid recording request.' }, { status: 400 })
  }

  const recordingId = id === 'active' ? payload.id : payload.id ?? id
  const recording = await endRecording(recordingId)

  if (!recording) {
    return Response.json({ error: 'Recording not found.' }, { status: 404 })
  }

  const { activeId } = await listRecordings()
  const response: RecordingResponse = {
    recording,
    activeId,
  }

  return Response.json(response)
}

function isEndRecordingRequest(value: unknown): value is EndRecordingRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Partial<EndRecordingRequest>
  return request.id === undefined || typeof request.id === 'string'
}

async function resolveRecordingId(id: string) {
  if (id !== 'active') return id
  const { activeId } = await listRecordings()
  return activeId
}
