'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, useEditor, type Editor, type TLEditorSnapshot } from 'tldraw'
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
  const [editor, setEditor] = useState<Editor | null>(null)
  const [snapshot, setSnapshot] = useState<TLEditorSnapshot | null>(null)
  const [diagramName, setDiagramName] = useState<string | null>(null)
  const [isSnapshotLoaded, setIsSnapshotLoaded] = useState(false)
  const saveNameTimerRef = useRef<number | null>(null)
  const hasInitializedNameRef = useRef(false)

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
          setDiagramName(payload.name ?? null)
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
      if (saveNameTimerRef.current) {
        window.clearTimeout(saveNameTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const trimmedName = diagramName?.trim()
    document.title = trimmedName ? `${trimmedName} · DiagramTalk` : 'DiagramTalk'
  }, [diagramName])

  useEffect(() => {
    if (!isSnapshotLoaded) return

    if (!hasInitializedNameRef.current) {
      hasInitializedNameRef.current = true
      return
    }

    if (saveNameTimerRef.current) {
      window.clearTimeout(saveNameTimerRef.current)
    }

    saveNameTimerRef.current = window.setTimeout(() => {
      saveNameTimerRef.current = null

      void fetch('/api/diagram/snapshot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: diagramName?.trim() || null }),
      }).catch((error) => {
        console.error('[DiagramWorkspace] Failed to save diagram name.', error)
      })
    }, 500)
  }, [diagramName, isSnapshotLoaded])

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
            <DiagramContextTracker
              onDiagramChange={handleDiagramChange}
              onEditorReady={setEditor}
              diagramName={diagramName}
            />
          </Tldraw>
        </div>
      </section>
      <ChatPanel
        diagram={diagram}
        diagramName={diagramName}
        editor={editor}
        onDiagramNameChange={setDiagramName}
      />
    </main>
  )
}

type DiagramContextTrackerProps = {
  onDiagramChange: (diagram: DiagramContext) => void
  onEditorReady: (editor: Editor) => void
  diagramName: string | null
}

function DiagramContextTracker({ onDiagramChange, onEditorReady, diagramName }: DiagramContextTrackerProps) {
  const editor = useEditor()

  useEffect(() => {
    onEditorReady(editor)
  }, [editor, onEditorReady])

  return <DiagramApiBridge diagramName={diagramName} editor={editor} onDiagramChange={onDiagramChange} />
}
