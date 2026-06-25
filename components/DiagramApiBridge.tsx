'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  createBindingId,
  createShapeId,
  getSnapshot,
  toRichText,
  useReactor,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLBindingCreate,
  type TLCreateShapePartial,
  type TLGeoShape,
  type TLNoteShape,
  type TLShapeId,
  type TLTextShape,
} from 'tldraw'
import { getCurrentDiagramContext } from '@/lib/diagramContext'
import type {
  CreateConnectionCommand,
  CreateShapeCommand,
  DiagramCommand,
  ListDiagramCommandsResponse,
  RenderFormat,
  RenderMetaResponse,
  SaveMetaResponse,
  SetCameraCommand,
} from '@/lib/diagramApiTypes'
import type { DiagramContext } from '@/lib/types'

type DiagramApiBridgeProps = {
  editor: Editor
  onDiagramChange: (diagram: DiagramContext) => void
  diagramName: string | null
  diagramId: string | null
  // Called when a queued command targets a different diagram, so the workspace
  // can switch to it (auto-activate) before the command is applied.
  onRequestActivate: (diagramId: string) => void
}

const POLL_INTERVAL_MS = 1500
const PUBLISH_DEBOUNCE_MS = 300
const SNAPSHOT_SAVE_DEBOUNCE_MS = 800
const RENDER_POLL_INTERVAL_MS = 1000
const SAVE_POLL_INTERVAL_MS = 1000

export function DiagramApiBridge({
  editor,
  onDiagramChange,
  diagramName,
  diagramId,
  onRequestActivate,
}: DiagramApiBridgeProps) {
  const publishTimerRef = useRef<number | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const processingCommandIdsRef = useRef(new Set<string>())
  const isRenderingRef = useRef(false)
  const lastRenderRequestRef = useRef<string | null>(null)
  // Guards against re-requesting a switch many times before React state catches
  // up: we ask the workspace to activate a target diagram at most once.
  const requestedActivationRef = useRef<string | null>(null)
  const lastSaveRequestRef = useRef<string | null>(null)

  const publishContext = useCallback((context: DiagramContext) => {
    if (publishTimerRef.current) {
      window.clearTimeout(publishTimerRef.current)
    }

    publishTimerRef.current = window.setTimeout(() => {
      publishTimerRef.current = null

      void fetch('/api/diagram/context', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ context }),
      }).catch((error) => {
        console.error('[DiagramApiBridge] Failed to publish diagram context.', error)
      })
    }, PUBLISH_DEBOUNCE_MS)
  }, [])

  const handleDiagramChange = useCallback(() => {
    const context = getCurrentDiagramContext(editor)

    onDiagramChange(context)
    publishContext(context)
  }, [editor, onDiagramChange, publishContext])

  const saveSnapshot = useCallback(() => {
    if (snapshotTimerRef.current) {
      window.clearTimeout(snapshotTimerRef.current)
    }

    snapshotTimerRef.current = window.setTimeout(() => {
      snapshotTimerRef.current = null
      const snapshot = getSnapshot(editor.store)

      void fetch('/api/diagram/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(diagramId ? { id: diagramId } : {}),
          snapshot,
          name: diagramName?.trim() || null,
        }),
      }).catch((error) => {
        console.error('[DiagramApiBridge] Failed to save diagram snapshot.', error)
      })
    }, SNAPSHOT_SAVE_DEBOUNCE_MS)
  }, [diagramId, diagramName, editor])

  useReactor('publish diagram api context', handleDiagramChange, [handleDiagramChange])
  useReactor(
    'autosave diagram snapshot',
    () => {
      editor.getCurrentPageShapes()
      saveSnapshot()
    },
    [editor, saveSnapshot],
  )

  useEffect(() => {
    return () => {
      if (publishTimerRef.current) {
        window.clearTimeout(publishTimerRef.current)
      }
      if (snapshotTimerRef.current) {
        window.clearTimeout(snapshotTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    let isDisposed = false

    async function pollCommands() {
      try {
        const response = await fetch('/api/diagram/commands?status=pending')

        if (!response.ok) return

        const payload = (await response.json()) as ListDiagramCommandsResponse

        for (const command of payload.commands) {
          if (isDisposed) return
          if (processingCommandIdsRef.current.has(command.id)) continue

          // Auto-activate: a command targeting another diagram is left pending
          // and the workspace is asked to switch to it (once); once that diagram
          // is loaded, its bridge applies the command.
          if (command.diagramId && command.diagramId !== diagramId) {
            if (requestedActivationRef.current === null) {
              requestedActivationRef.current = command.diagramId
              onRequestActivate(command.diagramId)
            }
            continue
          }

          processingCommandIdsRef.current.add(command.id)

          void applyAndReportCommand(editor, command)
            .then(() => {
              handleDiagramChange()
            })
            .finally(() => {
              processingCommandIdsRef.current.delete(command.id)
            })
        }
      } catch (error) {
        console.error('[DiagramApiBridge] Failed to poll diagram commands.', error)
      }
    }

    void pollCommands()
    const intervalId = window.setInterval(pollCommands, POLL_INTERVAL_MS)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
    }
  }, [diagramId, editor, handleDiagramChange, onRequestActivate])

  // Fulfill render requests: when the server reports a pending render request
  // for this (active) diagram, export the current page and upload the result.
  useEffect(() => {
    if (!diagramId) return

    let isDisposed = false

    async function pollRenderRequest() {
      if (isRenderingRef.current) return

      try {
        const response = await fetch(`/api/diagram/render?id=${diagramId}&meta=1`)
        if (!response.ok) return

        const meta = (await response.json()) as RenderMetaResponse
        const renderRequest = meta.request

        if (!renderRequest || lastRenderRequestRef.current === renderRequest.requestedAt) {
          return
        }

        // The render targets another diagram — switch to it (once) so its bridge renders.
        if (renderRequest.id !== diagramId) {
          if (requestedActivationRef.current === null) {
            requestedActivationRef.current = renderRequest.id
            onRequestActivate(renderRequest.id)
          }
          return
        }

        isRenderingRef.current = true
        try {
          const data = await exportCurrentPage(editor, renderRequest.format)
          await fetch('/api/diagram/render', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: diagramId, format: renderRequest.format, data }),
          })
          lastRenderRequestRef.current = renderRequest.requestedAt
        } finally {
          isRenderingRef.current = false
        }
      } catch (error) {
        if (!isDisposed) {
          console.error('[DiagramApiBridge] Failed to fulfill render request.', error)
        }
      }
    }

    const intervalId = window.setInterval(pollRenderRequest, RENDER_POLL_INTERVAL_MS)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
    }
  }, [diagramId, editor, onRequestActivate])

  // Fulfill explicit save requests: flush the current canvas immediately (the
  // snapshot route records savedAt, which clears the request).
  useEffect(() => {
    if (!diagramId) return

    let isDisposed = false

    async function pollSaveRequest() {
      try {
        const response = await fetch(`/api/diagram/save?id=${diagramId}`)
        if (!response.ok) return

        const meta = (await response.json()) as SaveMetaResponse
        const saveRequest = meta.request

        if (!saveRequest || lastSaveRequestRef.current === saveRequest.requestedAt) {
          return
        }

        // Targets another diagram — switch to it (once); its bridge will save.
        if (saveRequest.id !== diagramId) {
          if (requestedActivationRef.current === null) {
            requestedActivationRef.current = saveRequest.id
            onRequestActivate(saveRequest.id)
          }
          return
        }

        lastSaveRequestRef.current = saveRequest.requestedAt
        const snapshot = getSnapshot(editor.store)
        await fetch('/api/diagram/snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: diagramId, snapshot, name: diagramName?.trim() || null }),
        })
      } catch (error) {
        if (!isDisposed) {
          console.error('[DiagramApiBridge] Failed to fulfill save request.', error)
        }
      }
    }

    const intervalId = window.setInterval(pollSaveRequest, SAVE_POLL_INTERVAL_MS)

    return () => {
      isDisposed = true
      window.clearInterval(intervalId)
    }
  }, [diagramId, diagramName, editor, onRequestActivate])

  return null
}

async function applyAndReportCommand(editor: Editor, command: DiagramCommand) {
  try {
    applyDiagramCommand(editor, command)

    await reportCommandResult(command.id, { status: 'applied' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to apply diagram command.'

    await reportCommandResult(command.id, { status: 'failed', error: message })
  }
}

function applyDiagramCommand(editor: Editor, command: DiagramCommand) {
  if (command.type === 'createShape') {
    applyCreateShapeCommand(editor, command)
    return
  }

  if (command.type === 'clearDiagram') {
    applyClearDiagramCommand(editor)
    return
  }

  if (command.type === 'setCamera') {
    applySetCameraCommand(editor, command)
    return
  }

  applyCreateConnectionCommand(editor, command)
}

function applyClearDiagramCommand(editor: Editor) {
  const ids = [...editor.getCurrentPageShapeIds()]
  if (ids.length > 0) {
    editor.deleteShapes(ids)
  }
}

// Camera is view-only: it never creates, moves, or deletes shapes.
function applySetCameraCommand(editor: Editor, command: SetCameraCommand) {
  const input = command.input

  if (input.mode === 'absolute') {
    editor.setCamera({ x: input.x, y: input.y, z: input.zoom })
    return
  }

  const bounds = editor.getCurrentPageBounds()
  if (!bounds) return // nothing on the page to frame

  if (input.mode === 'fit') {
    editor.zoomToBounds(bounds, { inset: input.padding ?? 32 })
    return
  }

  // 'topLeft': frame content near the viewport's top-left, leaving the
  // right/bottom open (where the flow naturally extends).
  const margin = input.margin ?? 40
  const viewport = editor.getViewportScreenBounds()
  // Default zoom shows the whole diagram while keeping it in roughly the
  // upper-left of the viewport so empty canvas remains to the right/below.
  const z =
    input.zoom ??
    Math.max(0.1, Math.min((viewport.w * 0.6) / bounds.w, (viewport.h * 0.9) / bounds.h, 1))

  // viewport-relative screen = (page + camera) * z, so to put the content's
  // top-left at (margin, margin): camera = margin/z - pageTopLeft.
  editor.setCamera({
    x: margin / z - bounds.minX,
    y: margin / z - bounds.minY,
    z,
  })
}

function applyCreateShapeCommand(editor: Editor, command: CreateShapeCommand) {
  const id = toShapeId(command.input.id)

  if (editor.getShape(id)) {
    throw new Error(`Shape already exists: ${id}`)
  }

  editor.createShape(toCreateShapePartial(id, command))
  editor.select(id)
}

function toCreateShapePartial(
  id: TLShapeId,
  command: CreateShapeCommand,
): TLCreateShapePartial {
  const { input } = command
  const label = input.label ?? ''
  const width = input.w ?? defaultWidthForShape(input.type)
  const height = input.h ?? defaultHeightForShape(input.type)

  if (input.type === 'box' || input.type === 'ellipse') {
    const shape: TLCreateShapePartial<TLGeoShape> = {
      id,
      type: 'geo',
      x: input.x,
      y: input.y,
      props: {
        geo: input.type === 'box' ? 'rectangle' : 'ellipse',
        w: width,
        h: height,
        richText: toRichText(label),
        ...(input.color ? { color: input.color } : {}),
        ...(input.fill ? { fill: input.fill } : {}),
      },
    }

    return shape
  }

  if (input.type === 'note') {
    const shape: TLCreateShapePartial<TLNoteShape> = {
      id,
      type: 'note',
      x: input.x,
      y: input.y,
      props: {
        richText: toRichText(label),
        ...(input.color ? { color: input.color } : {}),
      },
    }

    return shape
  }

  const shape: TLCreateShapePartial<TLTextShape> = {
    id,
    type: 'text',
    x: input.x,
    y: input.y,
    props: {
      w: width,
      richText: toRichText(label),
      ...(input.color ? { color: input.color } : {}),
    },
  }

  return shape
}

const ANCHOR_POINTS: Record<string, { x: number; y: number }> = {
  top: { x: 0.5, y: 0 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
  center: { x: 0.5, y: 0.5 },
}

function resolveAnchor(side?: string) {
  const anchor = (side && ANCHOR_POINTS[side]) || ANCHOR_POINTS.center
  // A precise binding pins the arrow to that exact point on the shape edge;
  // 'center' keeps the legacy auto-routing behavior.
  return { anchor, isPrecise: Boolean(side) && side !== 'center' }
}

function anchorPointOnBounds(
  bounds: { x: number; y: number; w: number; h: number },
  anchor: { x: number; y: number },
) {
  return { x: bounds.x + bounds.w * anchor.x, y: bounds.y + bounds.h * anchor.y }
}

function applyCreateConnectionCommand(editor: Editor, command: CreateConnectionCommand) {
  const fromShapeId = toShapeId(command.input.fromShapeId)
  const toShapeIdValue = toShapeId(command.input.toShapeId)
  const arrowId = toShapeId(command.input.id)
  const fromShape = editor.getShape(fromShapeId)
  const toShape = editor.getShape(toShapeIdValue)

  if (!fromShape) {
    throw new Error(`Source shape not found: ${fromShapeId}`)
  }

  if (!toShape) {
    throw new Error(`Target shape not found: ${toShapeIdValue}`)
  }

  if (editor.getShape(arrowId)) {
    throw new Error(`Shape already exists: ${arrowId}`)
  }

  const fromBounds = editor.getShapePageBounds(fromShape)
  const toBounds = editor.getShapePageBounds(toShape)
  const start = resolveAnchor(command.input.fromAnchor)
  const end = resolveAnchor(command.input.toAnchor)

  // Initial terminal points: the chosen anchor on each shape's edge (falls back
  // to the shape origin if bounds are unavailable). Bindings keep these in sync.
  const fromPoint = fromBounds
    ? anchorPointOnBounds(fromBounds, start.anchor)
    : { x: fromShape.x, y: fromShape.y }
  const toPoint = toBounds
    ? anchorPointOnBounds(toBounds, end.anchor)
    : { x: toShape.x, y: toShape.y }

  const arrow: TLCreateShapePartial<TLArrowShape> = {
    id: arrowId,
    type: 'arrow',
    x: fromPoint.x,
    y: fromPoint.y,
    props: {
      start: { x: 0, y: 0 },
      end: { x: toPoint.x - fromPoint.x, y: toPoint.y - fromPoint.y },
      arrowheadStart: 'none',
      arrowheadEnd: command.input.directional === false ? 'none' : 'arrow',
      richText: toRichText(command.input.label ?? ''),
      ...(command.input.color ? { color: command.input.color } : {}),
      // 'orthogonal' uses tldraw's native elbow routing (axis-aligned bends);
      // omitting kind keeps the default straight/arc arrow.
      ...(command.input.routing === 'orthogonal' ? { kind: 'elbow' as const } : {}),
    },
  }
  const bindings: TLBindingCreate<TLArrowBinding>[] = [
    {
      id: createBindingId(`${command.id}-start`),
      type: 'arrow',
      fromId: arrowId,
      toId: fromShapeId,
      props: {
        terminal: 'start',
        normalizedAnchor: start.anchor,
        isExact: false,
        isPrecise: start.isPrecise,
      },
    },
    {
      id: createBindingId(`${command.id}-end`),
      type: 'arrow',
      fromId: arrowId,
      toId: toShapeIdValue,
      props: {
        terminal: 'end',
        normalizedAnchor: end.anchor,
        isExact: false,
        isPrecise: end.isPrecise,
      },
    },
  ]

  editor.createShape(arrow)
  editor.createBindings(bindings)
  editor.select(arrowId)
}

async function exportCurrentPage(editor: Editor, format: RenderFormat): Promise<string> {
  const shapeIds = [...editor.getCurrentPageShapeIds()]
  const options = { background: true, darkMode: false, scale: 1 }

  if (format === 'svg') {
    const svgEditor = editor as Editor & {
      getSvgString(ids: TLShapeId[], opts: typeof options): Promise<{ svg: string } | null>
    }
    const result = await svgEditor.getSvgString(shapeIds, options)
    return result?.svg ?? ''
  }

  const image = await editor.toImage(shapeIds, { ...options, format: 'png' })
  const buffer = await image.blob.arrayBuffer()
  return arrayBufferToBase64(buffer)
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

async function reportCommandResult(
  commandId: string,
  result:
    | {
        status: 'applied'
      }
    | {
        status: 'failed'
        error: string
      },
) {
  await fetch(`/api/diagram/commands/${commandId}/result`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(result),
  })
}

function toShapeId(id?: string): TLShapeId {
  if (!id) return createShapeId()
  if (id.startsWith('shape:')) return id as TLShapeId
  return createShapeId(id)
}

function defaultWidthForShape(type: CreateShapeCommand['input']['type']) {
  if (type === 'text') return 180
  if (type === 'note') return 200
  return 160
}

function defaultHeightForShape(type: CreateShapeCommand['input']['type']) {
  if (type === 'note') return 200
  return 96
}
