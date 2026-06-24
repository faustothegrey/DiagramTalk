'use client'

import type { DiagramSummary } from '@/lib/diagramApiTypes'

type DiagramSwitcherProps = {
  diagrams: DiagramSummary[]
  activeId: string | null
  busy: boolean
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export function DiagramSwitcher({
  diagrams,
  activeId,
  busy,
  onSelect,
  onCreate,
  onDelete,
}: DiagramSwitcherProps) {
  const activeDiagram = diagrams.find((diagram) => diagram.id === activeId) ?? null

  return (
    <div className="diagramBar">
      <label className="diagramBarLabel" htmlFor="diagramSelect">
        Diagram
      </label>
      <select
        className="diagramSelect"
        disabled={busy || diagrams.length === 0}
        id="diagramSelect"
        onChange={(event) => onSelect(event.target.value)}
        value={activeId ?? ''}
      >
        {diagrams.map((diagram) => (
          <option key={diagram.id} value={diagram.id}>
            {diagram.name?.trim() || 'Untitled diagram'}
          </option>
        ))}
      </select>

      <span className="diagramBarCount">
        {diagrams.length} {diagrams.length === 1 ? 'diagram' : 'diagrams'}
      </span>

      <div className="diagramBarActions">
        <button
          className="diagramBarButton"
          disabled={busy}
          onClick={onCreate}
          title="Create a new diagram"
          type="button"
        >
          + New
        </button>
        <button
          className="diagramBarButton diagramBarButtonDanger"
          disabled={busy || !activeDiagram}
          onClick={() => {
            if (!activeDiagram) return
            const label = activeDiagram.name?.trim() || 'this diagram'
            if (window.confirm(`Delete "${label}"? This cannot be undone.`)) {
              onDelete(activeDiagram.id)
            }
          }}
          title="Delete the active diagram"
          type="button"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
