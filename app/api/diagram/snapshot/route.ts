import {
  getStoredDiagramSnapshot,
  saveDiagramSnapshot,
} from '@/lib/diagramSnapshotStore'
import type {
  GetDiagramSnapshotResponse,
  PublishDiagramSnapshotRequest,
  PublishDiagramSnapshotResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const response: GetDiagramSnapshotResponse = await getStoredDiagramSnapshot()

    return Response.json(response)
  } catch (error) {
    console.error('[api/diagram/snapshot]', error)
    return Response.json({ error: 'Unable to read diagram snapshot.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isPublishDiagramSnapshotRequest(payload)) {
    return Response.json({ error: 'Invalid diagram snapshot request.' }, { status: 400 })
  }

  try {
    const updatedAt = await saveDiagramSnapshot({
      snapshot: payload.snapshot,
      name: payload.name,
    })
    const response: PublishDiagramSnapshotResponse = { ok: true, updatedAt }

    return Response.json(response)
  } catch (error) {
    console.error('[api/diagram/snapshot]', error)
    return Response.json({ error: 'Unable to save diagram snapshot.' }, { status: 500 })
  }
}

function isPublishDiagramSnapshotRequest(
  value: unknown,
): value is PublishDiagramSnapshotRequest {
  if (!value || typeof value !== 'object') return false

  const maybeRequest = value as Partial<PublishDiagramSnapshotRequest>
  const snapshot = maybeRequest.snapshot
  const name = maybeRequest.name

  const hasSnapshot = snapshot !== undefined
  const hasName = name !== undefined

  if (!hasSnapshot && !hasName) return false

  if (hasSnapshot && (!snapshot || typeof snapshot !== 'object')) return false

  if (hasName && name !== null && typeof name !== 'string') return false

  if (!hasSnapshot) return true

  const maybeSnapshot = snapshot as Record<string, unknown>

  return typeof maybeSnapshot.document === 'object' || typeof maybeSnapshot.store === 'object'
}
