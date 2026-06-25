'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  Tldraw,
  getSnapshot,
  useEditor,
  type Editor,
  type TLComponents,
  type TLEditorSnapshot,
} from 'tldraw'
import { DiagramApiBridge } from '@/components/DiagramApiBridge'
import { ChatPanel } from '@/components/ChatPanel'
import { DiagramSwitcher } from '@/components/DiagramSwitcher'
import { DiagramCanvasOverlay } from '@/components/DiagramCanvasOverlay'
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

// Hide tldraw's floating style panel (the color/fill/size/font picker that pops
// up next to a selected shape). Set a component to null to remove it.
const tldrawComponents: TLComponents = {
  InFrontOfTheCanvas: DiagramCanvasOverlay,
  StylePanel: null,
}

const PANEL_WIDTH_STORAGE_KEY = 'diagramtalk:panelWidth'
const DEFAULT_PANEL_WIDTH = 400
const MIN_PANEL_WIDTH = 320
const MIN_CANVAS_WIDTH = 480

function clampPanelWidth(width: number) {
  const max =
    typeof window !== 'undefined'
      ? Math.max(MIN_PANEL_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH)
      : 720
  return Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), max))
}

export function DiagramWorkspace() {
  const [diagram, setDiagram] = useState<DiagramContext>(emptyDiagram)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [snapshot, setSnapshot] = useState<TLEditorSnapshot | null>(null)
  const [diagrams, setDiagrams] = useState<DiagramSummary[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [diagramName, setDiagramName] = useState<string | null>(null)
  const [isLoaded, setIsLoaded] = useState(false)
  const [isBusy, setIsBusy] = useState(false)
  const [panelWidth, setPanelWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_PANEL_WIDTH
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampPanelWidth(stored) : DEFAULT_PANEL_WIDTH
  })
  const [isResizing, setIsResizing] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle')

  const saveNameTimerRef = useRef<number | null>(null)
  const hasInitializedNameRef = useRef(false)
  const saveStatusTimerRef = useRef<number | null>(null)

  const handleDiagramChange = useCallback((nextDiagram: DiagramContext) => {
    setDiagram(nextDiagram)
  }, [])

  // Drag the divider: the chat panel sits on the right, so its width is the
  // distance from the pointer to the right edge of the window.
  const handleResizePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
  }, [])

  const handleResizePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return
      setPanelWidth(clampPanelWidth(window.innerWidth - event.clientX))
    },
    [isResizing],
  )

  const handleResizePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing) return
      event.currentTarget.releasePointerCapture(event.pointerId)
      setIsResizing(false)
    },
    [isResizing],
  )

  const handleResizeKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16
    if (event.key === 'ArrowLeft') {
      event.preventDefault()
      setPanelWidth((current) => clampPanelWidth(current - step))
    } else if (event.key === 'ArrowRight') {
      event.preventDefault()
      setPanelWidth((current) => clampPanelWidth(current + step))
    }
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

  // Explicit "Save" — force-persist the current canvas now (in addition to the
  // background autosave), with brief "Saving…/Saved" feedback.
  const handleSaveDiagram = useCallback(async () => {
    if (!editor || !activeId) return

    if (saveStatusTimerRef.current) {
      window.clearTimeout(saveStatusTimerRef.current)
      saveStatusTimerRef.current = null
    }
    setSaveStatus('saving')

    try {
      const snapshot = getSnapshot(editor.store)
      const response = await fetch('/api/diagram/snapshot', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ id: activeId, snapshot, name: diagramName?.trim() || null }),
      })
      if (!response.ok) throw new Error(`Save failed with ${response.status}.`)

      setSaveStatus('saved')
      saveStatusTimerRef.current = window.setTimeout(() => {
        saveStatusTimerRef.current = null
        setSaveStatus('idle')
      }, 1600)
    } catch (error) {
      console.error('[DiagramWorkspace] Failed to save diagram.', error)
      setSaveStatus('idle')
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
      if (saveStatusTimerRef.current) {
        window.clearTimeout(saveStatusTimerRef.current)
      }
    }
  }, [loadRecord])

  useEffect(() => {
    const trimmedName = diagramName?.trim()
    document.title = trimmedName ? `${trimmedName} · DiagramTalk` : 'DiagramTalk'
  }, [diagramName])

  useEffect(() => {
    window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(panelWidth))
  }, [panelWidth])

  // Keep the panel within bounds when the window is resized.
  useEffect(() => {
    const onWindowResize = () => setPanelWidth((current) => clampPanelWidth(current))
    window.addEventListener('resize', onWindowResize)
    return () => window.removeEventListener('resize', onWindowResize)
  }, [])

  // While dragging, force the resize cursor and suppress text selection globally.
  useEffect(() => {
    if (!isResizing) return
    const previousCursor = document.body.style.cursor
    const previousSelect = document.body.style.userSelect
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousSelect
    }
  }, [isResizing])

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
        const response = await fetch(`/api/diagrams/${id}`, {
          method: 'PATCH',
          headers: JSON_HEADERS,
          body: JSON.stringify({ active: true }),
        })

        if (!response.ok) {
          throw new Error(`Switch failed with ${response.status}.`)
        }

        const payload = (await response.json()) as DiagramRecordResponse
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
    <main className="workspace" style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}>
      <section className="canvasRegion" aria-label="Whiteboard">
        <DiagramSwitcher
          activeId={activeId}
          busy={isBusy}
          diagrams={diagrams}
          onCreate={handleCreateDiagram}
          onDelete={handleDeleteDiagram}
          onSave={handleSaveDiagram}
          onSelect={handleSelectDiagram}
          saveStatus={saveStatus}
        />
        <div className="canvasFrame">
          <Tldraw
            key={activeId ?? 'none'}
            components={tldrawComponents}
            snapshot={snapshot ?? undefined}
          >
            <DiagramContextTracker
              diagramId={activeId}
              diagramName={diagramName}
              onDiagramChange={handleDiagramChange}
              onEditorReady={setEditor}
              onRequestActivate={handleSelectDiagram}
            />
          </Tldraw>
        </div>
      </section>
      <div
        aria-label="Resize chat panel"
        aria-orientation="vertical"
        className={isResizing ? 'resizeHandle resizeHandleActive' : 'resizeHandle'}
        onKeyDown={handleResizeKeyDown}
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerUp}
        role="separator"
        tabIndex={0}
      />
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
  onRequestActivate: (diagramId: string) => void
}

function DiagramContextTracker({
  onDiagramChange,
  onEditorReady,
  diagramName,
  diagramId,
  onRequestActivate,
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
      onRequestActivate={onRequestActivate}
    />
  )
}
