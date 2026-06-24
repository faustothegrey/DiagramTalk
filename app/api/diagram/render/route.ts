import { getActiveDiagram } from '@/lib/diagramStore'
import {
  getRender,
  getRenderRequest,
  requestRender,
  saveRender,
  type RenderFormat,
} from '@/lib/diagramRenderStore'
import type {
  RenderMetaResponse,
  RequestRenderResponse,
  UploadRenderRequest,
  UploadRenderResponse,
} from '@/lib/diagramApiTypes'

export const runtime = 'nodejs'

// GET ?id=&meta=1  -> render metadata + any pending request (polled by the bridge
//                     and by the CLI to detect a fresh render).
// GET ?id=         -> the cached render bytes (image/png or image/svg+xml), 404 if none.
export async function GET(request: Request) {
  const url = new URL(request.url)
  const id = url.searchParams.get('id') ?? (await getActiveDiagram())?.id ?? null

  if (!id) {
    return Response.json({ error: 'No diagram to render.' }, { status: 404 })
  }

  const render = getRender(id)

  if (url.searchParams.get('meta')) {
    const response: RenderMetaResponse = {
      id,
      format: render?.format ?? null,
      renderedAt: render?.renderedAt ?? null,
      request: getRenderRequest(),
    }
    return Response.json(response)
  }

  if (!render) {
    return Response.json({ error: 'No render available yet.' }, { status: 404 })
  }

  if (render.format === 'svg') {
    return new Response(render.data, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'X-Rendered-At': render.renderedAt,
      },
    })
  }

  return new Response(Buffer.from(render.data, 'base64'), {
    headers: {
      'Content-Type': 'image/png',
      'X-Rendered-At': render.renderedAt,
    },
  })
}

// POST -> request a fresh render of a diagram (defaults to the active one).
export async function POST(request: Request) {
  let payload: unknown = {}
  try {
    const text = await request.text()
    payload = text ? JSON.parse(text) : {}
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  const body = (payload ?? {}) as { id?: unknown; format?: unknown }
  const format: RenderFormat = body.format === 'svg' ? 'svg' : 'png'
  const id =
    typeof body.id === 'string' && body.id.length > 0
      ? body.id
      : (await getActiveDiagram())?.id ?? null

  if (!id) {
    return Response.json({ error: 'No diagram to render.' }, { status: 404 })
  }

  const created = requestRender(id, format)
  const response: RequestRenderResponse = {
    id,
    format,
    requestedAt: created.requestedAt,
  }
  return Response.json(response, { status: 202 })
}

// PUT -> the bridge uploads an exported render.
export async function PUT(request: Request) {
  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (!isUploadRenderRequest(payload)) {
    return Response.json({ error: 'Invalid render upload.' }, { status: 400 })
  }

  const renderedAt = saveRender(payload.id, payload.format, payload.data)
  const response: UploadRenderResponse = { ok: true, renderedAt }
  return Response.json(response)
}

function isUploadRenderRequest(value: unknown): value is UploadRenderRequest {
  if (!value || typeof value !== 'object') return false
  const body = value as Partial<UploadRenderRequest>
  return (
    typeof body.id === 'string' &&
    body.id.length > 0 &&
    (body.format === 'png' || body.format === 'svg') &&
    typeof body.data === 'string'
  )
}
