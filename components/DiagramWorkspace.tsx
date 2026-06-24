'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tldraw, getSnapshot, useEditor, type Editor, type TLEditorSnapshot } from 'tldraw'
import { DiagramApiBridge } from '@/components/DiagramApiBridge'
import { ChatPanel } from '@/components/ChatPanel'
import { DiagramSwitcher } from '@/components/DiagramSwitcher'
import type {
  DiagramRecord,
  DiagramRecordResponse,
  DeleteDiagramResponse,
  DiagramSummary,
  GetDiagramSnapshotResponse,
  ListDiagramsResponse,
} from '@/lib/diagramApiTypes'
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

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export function DiagramWorkspace() {
  const [diagram, setDiagram] = useState<DiagramContext>(emptyDiagram)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [snapshot, setSnapshot] = useState<TLEditorSnapshot | null>(null)
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [diagramName, setDiagramName] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isBusy, setIsBusy] = useState(false)

  const saveNameTimerRef = useRef<number | null>(null)
  const hasInitializedNameRef = useRef(false)

  const handleDiagramChange = useCallback((nextDiagram: DiagramContext) => {
    setDiagram(nextDiagram)
  }, [])

  const loadRecord = useCallback((record: DiagramRecord, nextActiveId: string | null) => {
    setSnapshot((record.snapshot as TLEditorSnapshot | null) ?? null)
    setDiagramName(record.name ?? null)
    setActiveId(nextActiveId ?? record.id)
  }, [])

  const refreshList = useCallback(async () => {
    try {
      const list = (await fetch('/api/diagrams').then((response) => response.json())) as ListDiagramsResponse
      setDiagrams(list.diagrams)
      setActiveId((current) => current ?? list.activeId)
    } catch (error) {
      console.error('[DiagramWorkspace] Failed to refresh diagram list.', error)
    }
  }, [])

  // Persist the active diagram's current canvas before switching away from it,
  // so unsaved edits (still inside the autosave debounce window) are not lost.
  const flushActiveSnapshot = useCallback(async () => {
    if (!editor || !activeId) return

    try {
      const currentSnapshot = getSnapshot(editor.store)
      await fetch('/api/diagram/snapshot', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({
          id: activeId,
          snapshot: currentSnapshot,
          name: diagramName?.trim() || null,
        }),
      })
    } catch (error) {
      console.error('[DiagramWorkspace] Failed to flush active diagram.', error)
    }
  }, [activeId, diagramName, editor])

  useEffect(() => {
    let isDisposed = false

    async function bootstrap() {
      try {
        const list = (await fetch('/api/diagrams').then((response) => response.json())) as ListDiagramsResponse

        if (list.diagrams.length === 0) {
          // First run with no saved diagrams — start with a blank one.
          const created = (await fetch('/api/diagrams', {
            method: 'POST',
            headers: JSON_HEADERS,
            body: JSON.stringify({}),
          }).then((response) => response.json())) as DiagramRecordResponse

          if (isDisposed) return
          setDiagrams([toSummary(created.diagram)])
          loadRecord(created.diagram, created.activeId)
          return
        }

        const active = (await fetch('/api/diagram/snapshot').then((response) =>
          response.json(),
        )) as GetDiagramSnapshotResponse

        if (isDisposed) return
        setDiagrams(list.diagrams)
        setSnapshot((active.snapshot as TLEditorSnapshot | null) ?? null)
        setDiagramName(active.name ?? null)
        setActiveId(active.id ?? list.activeId)
      } catch (error) {
        console.error('[DiagramWorkspace] Failed to load diagrams.', error)
      } finally {
        if (!isDisposed) setIsLoaded(true)
      }
    }

    void bootstrap()

    return () => {
      isDisposed = true
      if (saveNameTimerRef.current) {
        window.clearTimeout(saveNameTimerRef.current)
      }
    }
  }, [loadRecord])

  useEffect(() => {
    const trimmedName = diagramName?.trim()
    document.title = trimmedName ? `${trimmedName} · DiagramTalk` : 'DiagramTalk'
  }, [diagramName])

  // Debounced save of the active diagram's name, plus an optimistic update of
  // the switcher list so the rename shows up immediately.
  useEffect(() => {
    if (!isLoaded || !activeId) return

    if (!hasInitializedNameRef.current) {
      hasInitializedNameRef.current = true
      return
    }

    const trimmedName = diagramName?.trim() || null
    setDiagrams((current) =>
      current.map((entry) => (entry.id === activeId ? { ...entry, name: trimmedName } : entry)),
    )

    if (saveNameTimerRef.current) {
      window.clearTimeout(saveNameTimerRef.current)
    }

    saveNameTimerRef.current = window.setTimeout(() => {
      saveNameTimerRef.current = null

      void fetch('/api/diagram/snapshot', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: activeId, name: trimmedName }),
      }).catch((error) => {
        console.error('[DiagramWorkspace] Failed to save diagram name.', error)
      })
    }, 500)
  }, [activeId, diagramName, isLoaded])

  const handleSelectDiagram = useCallback(
    async (id: string) => {
      if (id === activeId || isBusy) return

      setIsBusy(true)
      try {
        await flushActiveSnapshot()
        const payload = (await fetch(`/api/diagrams/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ active: true }),
        }).then((response) => response.json())) as DiagramRecordResponse

        loadRecord(payload.diagram, payload.activeId)
        await refreshList()
      } catch (error) {
        console.error('[DiagramWorkspace] Failed to switch diagram.', error)
      } finally {
        setIsBusy(false)
      }
    },
    [activeId, flushActiveSnapshot, isBusy, loadRecord, refreshList],
  )

  const handleCreateDiagram = useCallback(async () => {
    if (isBusy) return

    setIsBusy(true)
    try {
      await flushActiveSnapshot()
      const payload = (await fetch('/api/diagrams', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ name: null }),
      }).then((response) => response.json())) as DiagramRecordResponse

      loadRecord(payload.diagram, payload.activeId)
      await refreshList()
    } catch (error) {
      console.error('[DiagramWorkspace] Failed to create diagram.', error)
    } finally {
      setIsBusy(false)
    }
  }, [flushActiveSnapshot, isBusy, loadRecord, refreshList])

  const handleDeleteDiagram = useCallback(
    async (id: string) => {
      if (isBusy) return

      setIsBusy(true)
      try {
        const result = (await fetch(`/api/diagrams/${id}`, { method: 'DELETE' }).then((response) =>
          response.json(),
        )) as DeleteDiagramResponse

        if (id === activeId) {
          if (result.activeId) {
            const next = (await fetch(`/api/diagrams/${result.activeId}`).then((response) =>
              response.json(),
            )) as DiagramRecordResponse
            loadRecord(next.diagram, result.activeId)
          } else {
            // Deleted the last diagram — start a fresh blank one.
            const created = (await fetch('/api/diagrams', {
              method: 'POST',
              headers: JSON_HEADERS,
              body: JSON.stringify({}),
            }).then((response) => response.json())) as DiagramRecordResponse
            loadRecord(created.diagram, created.activeId)
          }
        }

        await refreshList()
      } catch (error) {
        console.error('[DiagramWorkspace] Failed to delete diagram.', error)
      } finally {
        setIsBusy(false)
      }
    },
    [activeId, isBusy, loadRecord, refreshList],
  )

  if (!isLoaded) {
    return (
      <main className="workspaceLoading">
        <p>Loading diagram...</p>
      </main>
    )
  }

  return (
    <main className="workspace">
      <section className="canvasRegion" aria-label="Whiteboard">
        <DiagramSwitcher
          activeId={activeId}
          busy={isBusy}
          diagrams={diagrams}
          onCreate={handleCreateDiagram}
          onDelete={handleDeleteDiagram}
          onSelect={handleSelectDiagram}
        />
        <div className="canvasFrame">
          <Tldraw key={activeId ?? 'none'} snapshot={snapshot ?? undefined}>
            <DiagramContextTracker
              diagramId={activeId}
              diagramName={diagramName}
              onDiagramChange={handleDiagramChange}
              onEditorReady={setEditor}
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

function toSummary(record: DiagramRecord): DiagramSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

type DiagramContextTrackerProps = {
  onDiagramChange: (diagram: DiagramContext) => void
  onEditorReady: (editor: Editor) => void
  diagramName: string | null
  diagramId: string | null
}

function DiagramContextTracker({
  onDiagramChange,
  onEditorReady,
  diagramName,
  diagramId,
}: DiagramContextTrackerProps) {
  const editor = useEditor()

  useEffect(() => {
    onEditorReady(editor)
  }, [editor, onEditorReady])

  return (
    <DiagramApiBridge
      diagramId={diagramId}
      diagramName={diagramName}
      editor={editor}
      onDiagramChange={onDiagramChange}
    />
  )
}
