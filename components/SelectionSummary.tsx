import type { DiagramSelectionContext } from '@/lib/types'

type SelectionSummaryProps = {
  selection: DiagramSelectionContext
}

export function SelectionSummary({ selection }: SelectionSummaryProps) {
  const count = selection.shapes.length

  if (count === 0) {
    return (
      <section className="selectionSummary" aria-label="Current selection">
        <p className="selectionLabel">Selection</p>
        <p className="selectionMain">No selection</p>
        <p className="selectionMeta">Select a shape or arrow before asking a diagram-specific question.</p>
      </section>
    )
  }

  const typeCounts = selection.shapes.reduce<Record<string, number>>((counts, shape) => {
    counts[shape.type] = (counts[shape.type] ?? 0) + 1
    return counts
  }, {})

  const typeSummary = Object.entries(typeCounts)
    .map(([type, amount]) => `${amount} ${type}`)
    .join(', ')

  return (
    <section className="selectionSummary" aria-label="Current selection">
      <p className="selectionLabel">Selection</p>
      <p className="selectionMain">
        {count === 1 ? '1 selected shape' : `${count} selected shapes`}
      </p>
      <p className="selectionMeta">{typeSummary}</p>
      {count === 1 ? <p className="selectionMeta">{selection.shapeIds[0]}</p> : null}
    </section>
  )
}
