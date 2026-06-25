import { getActiveDiagram, getDiagram } from '@/lib/diagramStore'
import { listRecordings, startRecording } from '@/lib/diagramRecordingStore'
import type {
  ListRecordingsResponse,
  RecordingResponse,
  StartRecordingRequest,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

export async function GET() {
  const response: ListRecordingsResponse = await listRecordings()
  return Response.json(response)
}

export async function POST(request: Request) {
  let payload: unknown = {}

  try {
    const text = await request.text()
    payload = text ? JSON.parse(text) : {}
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isStartRecordingRequest(payload)) {
    return Response.json({ error: 'Invalid recording request.' }, { status: 400 })
  }

  const diagramId =
    typeof payload.diagramId === 'string' && payload.diagramId.length > 0
      ? payload.diagramId
      : (await getActiveDiagram())?.id ?? null

  if (!diagramId) {
    return Response.json({ error: 'No diagram to record.' }, { status: 404 })
  }

  if (!(await getDiagram(diagramId))) {
    return Response.json({ error: 'Diagram not found.' }, { status: 404 })
  }

  const recording = await startRecording({ diagramId, name: payload.name })
  const response: RecordingResponse = {
    recording,
    activeId: recording.id,
  }

  return Response.json(response, { status: 201 })
}

function isStartRecordingRequest(value: unknown): value is StartRecordingRequest {
  if (!value || typeof value !== 'object') return false

  const request = value as Partial<StartRecordingRequest>
  return (
    (request.diagramId === undefined || typeof request.diagramId === 'string') &&
    (request.name === undefined || request.name === null || typeof request.name === 'string')
  )
}
