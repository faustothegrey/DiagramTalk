'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { useEditor, useValue, type TLShapeId } from 'tldraw'
import {
  DIAGRAM_STATE_TAG_EVENT,
  type DiagramStateTagEventDetail,
  type StateTagColor,
} from '@/lib/diagramStateTags'

type StateTagEntry = {
  tagId: string
  shapeId: string
  label: string
  color: StateTagColor
}

const colorClasses: Record<StateTagColor, string> = {
  blue: 'diagramStateTagBlue',
  green: 'diagramStateTagGreen',
  yellow: 'diagramStateTagYellow',
  red: 'diagramStateTagRed',
  violet: 'diagramStateTagViolet',
  grey: 'diagramStateTagGrey',
}

export function DiagramStateTagOverlay() {
  const editor = useEditor()
  const [tags, setTags] = useState<StateTagEntry[]>([])

  useEffect(() => {
    function handleStateTag(event: Event) {
      const detail = (event as CustomEvent<DiagramStateTagEventDetail>).detail
      if (!detail?.tagId) return

      if (detail.clear) {
        setTags((current) => current.filter((tag) => tag.tagId !== detail.tagId))
        return
      }

      setTags((current) => [
        ...current.filter((tag) => tag.tagId !== detail.tagId),
        {
          tagId: detail.tagId,
          shapeId: detail.shapeId,
          label: detail.label,
          color: detail.color,
        },
      ])
    }

    window.addEventListener(DIAGRAM_STATE_TAG_EVENT, handleStateTag)
    return () => window.removeEventListener(DIAGRAM_STATE_TAG_EVENT, handleStateTag)
  }, [])

  const positionedTags = useValue(
    'diagramtalk state tags',
    () => {
      editor.getCamera()

      return tags.flatMap((tag) => {
        const shape = editor.getShape(tag.shapeId as TLShapeId)
        if (!shape) return []

        const bounds = editor.getShapePageBounds(shape)
        if (!bounds) return []

        const topRight = editor.pageToScreen({ x: bounds.maxX, y: bounds.minY })
        const style = {
          left: topRight.x,
          top: topRight.y,
        } as CSSProperties

        return [{ ...tag, style }]
      })
    },
    [editor, tags],
  )

  if (positionedTags.length === 0) return null

  return (
    <div className="diagramStateTagLayer" aria-hidden="true">
      {positionedTags.map((tag) => (
        <div
          className={`diagramStateTag ${colorClasses[tag.color]}`}
          key={tag.tagId}
          style={tag.style}
        >
          {tag.label}
        </div>
      ))}
    </div>
  )
}
