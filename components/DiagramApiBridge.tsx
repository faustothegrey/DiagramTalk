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
} from '@/lib/diagramApiTypes'
import type { DiagramContext } from '@/lib/types'

type DiagramApiBridgeProps = {
  editor: Editor
  onDiagramChange: (diagram: DiagramContext) => void
  diagramName: string | null
}

const POLL_INTERVAL_MS = 1500
const PUBLISH_DEBOUNCE_MS = 300
const SNAPSHOT_SAVE_DEBOUNCE_MS = 800

export function DiagramApiBridge({ editor, onDiagramChange, diagramName }: DiagramApiBridgeProps) {
  const publishTimerRef = useRef<number | null>(null)
  const snapshotTimerRef = useRef<number | null>(null)
  const processingCommandIdsRef = useRef(new Set<string>())

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
        body: JSON.stringify({ snapshot, name: diagramName?.trim() || null }),
      }).catch((error) => {
        console.error('[DiagramApiBridge] Failed to save diagram snapshot.', error)
      })
    }, SNAPSHOT_SAVE_DEBOUNCE_MS)
  }, [diagramName, editor])

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
  }, [editor, handleDiagramChange])

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

  applyCreateConnectionCommand(editor, command)
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
    },
  }

  return shape
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

  const fromCenter = editor.getShapePageBounds(fromShape)?.center ?? {
    x: fromShape.x,
    y: fromShape.y,
  }
  const toCenter = editor.getShapePageBounds(toShape)?.center ?? {
    x: toShape.x,
    y: toShape.y,
  }
  const arrow: TLCreateShapePartial<TLArrowShape> = {
    id: arrowId,
    type: 'arrow',
    x: fromCenter.x,
    y: fromCenter.y,
    props: {
      start: { x: 0, y: 0 },
      end: { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y },
      arrowheadStart: 'none',
      arrowheadEnd: command.input.directional === false ? 'none' : 'arrow',
      richText: toRichText(command.input.label ?? ''),
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
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
    },
    {
      id: createBindingId(`${command.id}-end`),
      type: 'arrow',
      fromId: arrowId,
      toId: toShapeIdValue,
      props: {
        terminal: 'end',
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isExact: false,
        isPrecise: false,
      },
    },
  ]

  editor.createShape(arrow)
  editor.createBindings(bindings)
  editor.select(arrowId)
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
