'use client'

import { useCallback, useState } from 'react'
import { Tldraw, useEditor } from 'tldraw'
import { DiagramApiBridge } from '@/components/DiagramApiBridge'
import { ChatPanel } from '@/components/ChatPanel'
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

  return <DiagramApiBridge editor={editor} onDiagramChange={onDiagramChange} />
}
