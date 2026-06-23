'use client'

import { useCallback, useState } from 'react'
import { Tldraw, useEditor, useReactor } from 'tldraw'
import { ChatPanel } from '@/components/ChatPanel'
import { getCurrentDiagramContext } from '@/lib/diagramContext'
import type { DiagramContext } from '@/lib/types'

const emptyDiagram: DiagramContext = {
  selectedShapeIds: [],
  selectedShapes: [],
  selectedConnections: [],
  shapes: [],
  bindings: [],
  connections: [],
  summary: {
    shapeCount: 0,
    connectionCount: 0,
    selectedShapeCount: 0,
    shapeTypes: {},
  },
}

export function DiagramWorkspace() {
  const [diagram, setDiagram] = useState<DiagramContext>(emptyDiagram)

  const handleDiagramChange = useCallback((nextDiagram: DiagramContext) => {
    setDiagram(nextDiagram)
  }, [])

  return (
    <main className="workspace">
      <section className="canvasRegion" aria-label="Whiteboard">
        <div className="canvasFrame">
          <Tldraw>
            <DiagramContextTracker onDiagramChange={handleDiagramChange} />
          </Tldraw>
        </div>
      </section>
      <ChatPanel diagram={diagram} />
    </main>
  )
}

type DiagramContextTrackerProps = {
  onDiagramChange: (diagram: DiagramContext) => void
}

function DiagramContextTracker({ onDiagramChange }: DiagramContextTrackerProps) {
  const editor = useEditor()

  useReactor(
    'track diagram context',
    () => {
      onDiagramChange(getCurrentDiagramContext(editor))
    },
    [editor, onDiagramChange],
  )

  return null
}
