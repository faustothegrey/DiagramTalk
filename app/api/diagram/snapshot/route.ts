import {
  getActiveDiagram,
  updateDiagram,
} from '@/lib/diagramStore'
import { markSaved } from '@/lib/diagramSaveStore'
import type {
  GetDiagramSnapshotResponse,
  PublishDiagramSnapshotRequest,
  PublishDiagramSnapshotResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const active = await getActiveDiagram()
    const response: GetDiagramSnapshotResponse = active
      ? {
          id: active.id,
          snapshot: active.snapshot,
          name: active.name,
          updatedAt: active.updatedAt,
        }
      : { id: null, snapshot: null, name: null, updatedAt: null }

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
    // A save targets the diagram named by `id`, falling back to the active one.
    const targetId = payload.id ?? (await getActiveDiagram())?.id ?? null

    if (!targetId) {
      return Response.json({ error: 'No diagram to save.' }, { status: 404 })
    }

    const updated = await updateDiagram(targetId, {
      snapshot: payload.snapshot,
      name: payload.name,
    })

    if (!updated) {
      return Response.json({ error: 'Diagram not found.' }, { status: 404 })
    }

    // A snapshot save (not a name-only update) satisfies any pending save request.
    if (payload.snapshot !== undefined) {
      markSaved(targetId)
    }

    const response: PublishDiagramSnapshotResponse = { ok: true, updatedAt: updated.updatedAt }
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
  const id = maybeRequest.id
  const snapshot = maybeRequest.snapshot
  const name = maybeRequest.name

  const hasSnapshot = snapshot !== undefined
  const hasName = name !== undefined

  if (id !== undefined && typeof id !== 'string') return false
  if (!hasSnapshot && !hasName) return false

  if (hasSnapshot && (!snapshot || typeof snapshot !== 'object')) return false

  if (hasName && name !== null && typeof name !== 'string') return false

  if (!hasSnapshot) return true

  const maybeSnapshot = snapshot as Record<string, unknown>

  return typeof maybeSnapshot.document === 'object' || typeof maybeSnapshot.store === 'object'
}
