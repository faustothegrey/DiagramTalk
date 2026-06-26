'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import {
  DIAGRAM_HIGHLIGHT_EVENT,
  type DiagramHighlightEventDetail,
  type HighlightColor,
} from '@/lib/diagramHighlight'
import { useEditorContainerOffset } from '@/components/useEditorContainerOffset'

type HighlightEntry = DiagramHighlightEventDetail & {
  key: string
}

const colorClasses: Record<HighlightColor, string> = {
  yellow: 'diagramHighlightPulseYellow',
  blue: 'diagramHighlightPulseBlue',
  green: 'diagramHighlightPulseGreen',
  red: 'diagramHighlightPulseRed',
  violet: 'diagramHighlightPulseViolet',
}

export function DiagramHighlightOverlay() {
  const editor = useEditor()
  const containerOffset = useEditorContainerOffset(editor)
  const [entries, setEntries] = useState<HighlightEntry[]>([])
  const timersRef = useRef<number[]>([])

  useEffect(() => {
    function handleHighlight(event: Event) {
      const detail = (event as CustomEvent<DiagramHighlightEventDetail>).detail
      if (!detail?.ids?.length) return

      const key = crypto.randomUUID()
      const entry: HighlightEntry = { ...detail, key }

      setEntries((current) => [...current, entry])
      const timer = window.setTimeout(() => {
        setEntries((current) => current.filter((candidate) => candidate.key !== key))
      }, detail.durationMs + 300)
      timersRef.current.push(timer)
    }

    window.addEventListener(DIAGRAM_HIGHLIGHT_EVENT, handleHighlight)

    return () => {
      window.removeEventListener(DIAGRAM_HIGHLIGHT_EVENT, handleHighlight)
      for (const timer of timersRef.current) {
        window.clearTimeout(timer)
      }
      timersRef.current = []
    }
  }, [])

  const pulses = useValue(
    'diagramtalk highlight pulses',
    () => {
      editor.getCamera()

      return entries.flatMap((entry) =>
        entry.ids.flatMap((id) => {
          const shape = editor.getShape(id as TLShapeId)
          if (!shape) return []

          const bounds = editor.getShapePageBounds(shape)
          if (!bounds) return []

          const topLeft = editor.pageToScreen({ x: bounds.minX, y: bounds.minY })
          const bottomRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.maxY })
          const style = {
            left: topLeft.x - containerOffset.left - entry.padding,
            top: topLeft.y - containerOffset.top - entry.padding,
            width: bottomRight.x - topLeft.x + entry.padding * 2,
            height: bottomRight.y - topLeft.y + entry.padding * 2,
            '--diagram-highlight-duration': `${entry.durationMs}ms`,
          } as CSSProperties

          return [
            {
              key: `${entry.key}:${id}`,
              className: colorClasses[entry.color],
              style,
            },
          ]
        }),
      )
    },
    [containerOffset.left, containerOffset.top, editor, entries],
  )

  if (pulses.length === 0) return null

  return (
    <div className="diagramHighlightLayer" aria-hidden="true">
      {pulses.map((pulse) => (
        <div
          className={`diagramHighlightPulse ${pulse.className}`}
          key={pulse.key}
          style={pulse.style}
        />
      ))}
    </div>
  )
}
