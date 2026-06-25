'use client'

import { DiagramHighlightOverlay } from '@/components/DiagramHighlightOverlay'
import { DiagramStateTagOverlay } from '@/components/DiagramStateTagOverlay'

export function DiagramCanvasOverlay() {
  return (
    <>
      <DiagramHighlightOverlay />
      <DiagramStateTagOverlay />
    </>
  )
}
