'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tldraw, useEditor, type TLEditorSnapshot } from 'tldraw'
import { DiagramApiBridge } from '@/components/DiagramApiBridge'
import { ChatPanel } from '@/components/ChatPanel'
import type { GetDiagramSnapshotResponse } from '@/lib/diagramApiTypes'
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
  const [snapshot, setSnapshot] = useState<TLEditorSnapshot | null>(null)
  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false)

  const handleDiagramChange = useCallback((nextDiagram: DiagramContext) => {
    setDiagram(nextDiagram)
  }, [])

  useEffect(() => {
    let isDisposed = false

    async function loadSnapshot() {
      try {
        const response = await fetch('/api/diagram/snapshot')

        if (!response.ok) {
          throw new Error(`Snapshot request failed with ${response.status}.`)
        }

        const payload = (await response.json()) as GetDiagramSnapshotResponse

        if (!isDisposed) {
          setSnapshot((payload.snapshot as TLEditorSnapshot | null) ?? null)
        }
      } catch (error) {
        console.error('[DiagramWorkspace] Failed to load saved diagram snapshot.', error)
      } finally {
        if (!isDisposed) {
          setIsSnapshotLoaded(true)
        }
      }
    }

    void loadSnapshot()

    return () => {
      isDisposed = true
    }
  }, [])

  if (!isSnapshotLoaded) {
    return (
      <main className="workspaceLoading">
        <p>Loading diagram...</p>
      </main>
    )
  }

  return (
    <main className="workspace">
      <section className="canvasRegion" aria-label="Whiteboard">
        <div className="canvasFrame">
          <Tldraw snapshot={snapshot ?? undefined}>
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
