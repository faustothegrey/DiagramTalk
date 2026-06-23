import type { DiagramContext } from '@/lib/types'

type SelectionSummaryProps = {
  diagram: DiagramContext
}

export function SelectionSummary({ diagram }: SelectionSummaryProps) {
  const count = diagram.selectedShapes.length
  const connectionCount = diagram.selectedConnections.length
  const visibleConnections =
    diagram.selectedConnections.length > 0 ? diagram.selectedConnections : diagram.connections.slice(0, 3)

  if (count === 0) {
    return (
      <section className="selectionSummary" aria-label="Current selection">
        <p className="selectionLabel">Selection</p>
        <p className="selectionMain">No selection</p>
        <p className="selectionMeta">
          Canvas context: {diagram.summary.shapeCount} shapes, {diagram.summary.connectionCount} connections.
        </p>
        <ConnectionList connections={visibleConnections} />
      </section>
    )
  }

  const typeCounts = diagram.selectedShapes.reduce<Record<string, number>>((counts, shape) => {
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
      <p className="selectionMeta">
        Related context: {connectionCount} {connectionCount === 1 ? 'connection' : 'connections'}.
      </p>
      <p className="selectionMeta">
        Canvas context: {diagram.summary.shapeCount} shapes, {diagram.summary.connectionCount} connections.
      </p>
      <ConnectionList connections={visibleConnections} />
      {count === 1 ? <p className="selectionMeta">{diagram.selectedShapeIds[0]}</p> : null}
    </section>
  )
}

type ConnectionListProps = {
  connections: DiagramContext['connections']
}

function ConnectionList({ connections }: ConnectionListProps) {
  if (connections.length === 0) return null

  return (
    <ul className="connectionList" aria-label="Diagram connections">
      {connections.map((connection) => (
        <li key={connection.arrowId}>{formatConnection(connection)}</li>
      ))}
    </ul>
  )
}

function formatConnection(connection: DiagramContext['connections'][number]) {
  const start = connection.startShapeLabel ?? shortenId(connection.startShapeId) ?? 'unbound start'
  const end = connection.endShapeLabel ?? shortenId(connection.endShapeId) ?? 'unbound end'
  const hasStartArrowhead = !!connection.arrowheadStart && connection.arrowheadStart !== 'none'
  const hasEndArrowhead = !!connection.arrowheadEnd && connection.arrowheadEnd !== 'none'
  const arrow =
    hasStartArrowhead && hasEndArrowhead
      ? '<->'
      : hasStartArrowhead
        ? '<-'
        : hasEndArrowhead
          ? '->'
          : '-'
  const label = connection.arrowLabel ? ` (${connection.arrowLabel})` : ''

  return `${start} ${arrow} ${end}${label}`
}

function shortenId(id: string | null) {
  if (!id) return undefined
  return id.replace(/^shape:/, '').slice(0, 8)
}
