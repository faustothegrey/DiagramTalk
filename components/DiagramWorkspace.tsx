'use client'

import { useCallback, useState } from 'react'
import { Tldraw, useEditor, useReactor } from 'tldraw'
import { ChatPanel } from '@/components/ChatPanel'
import { getSelectedDiagramContext } from '@/lib/diagramContext'
import type { DiagramSelectionContext } from '@/lib/types'

const emptySelection: DiagramSelectionContext = {
  shapeIds: [],
  shapes: [],
}

export function DiagramWorkspace() {
  const [selection, setSelection] = useState<DiagramSelectionContext>(emptySelection)

  const handleSelectionChange = useCallback((nextSelection: DiagramSelectionContext) => {
    setSelection(nextSelection)
  }, [])

  return (
    <main className="workspace">
      <section className="canvasRegion" aria-label="Whiteboard">
        <div className="canvasFrame">
          <Tldraw>
            <SelectionTracker onSelectionChange={handleSelectionChange} />
          </Tldraw>
        </div>
      </section>
      <ChatPanel selection={selection} />
    </main>
  )
}

type SelectionTrackerProps = {
  onSelectionChange: (selection: DiagramSelectionContext) => void
}

function SelectionTracker({ onSelectionChange }: SelectionTrackerProps) {
  const editor = useEditor()

  useReactor(
    'track selected diagram context',
    () => {
      onSelectionChange(getSelectedDiagramContext(editor))
    },
    [editor, onSelectionChange],
  )

  return null
}
