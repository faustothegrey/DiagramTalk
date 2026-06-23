import {
  renderPlaintextFromRichText,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLRichText,
  type TLShape,
} from 'tldraw'
import type {
  DiagramBindingContext,
  DiagramConnectionContext,
  DiagramContext,
  DiagramShapeContext,
} from './types'

export function toDiagramShapeContext(editor: Editor, shape: TLShape): DiagramShapeContext {
  const bounds = editor.getShapePageBounds(shape)
  const label = getShapeLabel(editor, shape)

  return {
    id: shape.id,
    type: shape.type,
    label,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    bounds: bounds?.toJson(),
    props: shape.props,
  }
}

export function getCurrentDiagramContext(editor: Editor): DiagramContext {
  const selectedShapeIds = editor.getSelectedShapeIds()
  const shapes = editor.getCurrentPageShapesInReadingOrder()
  const shapeContexts = shapes.map((shape) => toDiagramShapeContext(editor, shape))
  const shapeContextById = new Map(shapeContexts.map((shape) => [shape.id, shape]))
  const arrowShapes = shapes.filter(isArrowShape)
  const bindings = uniqueBindings(
    arrowShapes.flatMap((shape) => editor.getBindingsFromShape<TLArrowBinding>(shape, 'arrow')),
  )
  const bindingContexts = bindings.map(toDiagramBindingContext)
  const connections = arrowShapes.map((arrow) =>
    toDiagramConnectionContext(arrow, bindings, shapeContextById),
  )
  const selectedIdSet = new Set<string>(selectedShapeIds)
  const selectedShapes = shapeContexts.filter((shape) => selectedIdSet.has(shape.id))
  const selectedConnections = connections.filter(
    (connection) =>
      selectedIdSet.has(connection.arrowId) ||
      (connection.startShapeId ? selectedIdSet.has(connection.startShapeId) : false) ||
      (connection.endShapeId ? selectedIdSet.has(connection.endShapeId) : false),
  )

  return {
    selectedShapeIds,
    selectedShapes,
    selectedConnections,
    shapes: shapeContexts,
    bindings: bindingContexts,
    connections,
    summary: {
      shapeCount: shapeContexts.length,
      connectionCount: connections.length,
      selectedShapeCount: selectedShapes.length,
      shapeTypes: countShapeTypes(shapeContexts),
    },
  }
}

function toDiagramBindingContext(binding: TLArrowBinding): DiagramBindingContext {
  return {
    id: binding.id,
    type: binding.type,
    fromId: binding.fromId,
    toId: binding.toId,
    terminal: binding.props.terminal,
    props: binding.props,
  }
}

function toDiagramConnectionContext(
  arrow: TLArrowShape,
  bindings: TLArrowBinding[],
  shapeContextById: Map<string, DiagramShapeContext>,
): DiagramConnectionContext {
  const arrowBindings = bindings.filter((binding) => binding.fromId === arrow.id)
  const startBinding = arrowBindings.find((binding) => binding.props.terminal === 'start')
  const endBinding = arrowBindings.find((binding) => binding.props.terminal === 'end')
  const startShape = startBinding ? shapeContextById.get(startBinding.toId) : undefined
  const endShape = endBinding ? shapeContextById.get(endBinding.toId) : undefined
  const arrowLabel = shapeContextById.get(arrow.id)?.label

  return {
    arrowId: arrow.id,
    arrowLabel,
    startShapeId: startBinding?.toId ?? null,
    startShapeLabel: startShape?.label,
    endShapeId: endBinding?.toId ?? null,
    endShapeLabel: endShape?.label,
    arrowheadStart: arrow.props.arrowheadStart,
    arrowheadEnd: arrow.props.arrowheadEnd,
    isDirectional: arrow.props.arrowheadStart !== 'none' || arrow.props.arrowheadEnd !== 'none',
  }
}

function getShapeLabel(editor: Editor, shape: TLShape): string | undefined {
  const props = shape.props as { richText?: unknown; text?: unknown }

  if (props.richText) {
    const plaintext = renderPlaintextFromRichText(editor, props.richText as TLRichText).trim()
    return plaintext.length > 0 ? plaintext : undefined
  }

  if (typeof props.text === 'string') {
    const text = props.text.trim()
    return text.length > 0 ? text : undefined
  }

  return undefined
}

function isArrowShape(shape: TLShape): shape is TLArrowShape {
  return shape.type === 'arrow'
}

function uniqueBindings(bindings: TLArrowBinding[]): TLArrowBinding[] {
  const seen = new Set<string>()
  const unique: TLArrowBinding[] = []

  for (const binding of bindings) {
    if (seen.has(binding.id)) continue
    seen.add(binding.id)
    unique.push(binding)
  }

  return unique
}

function countShapeTypes(shapes: DiagramShapeContext[]) {
  return shapes.reduce<Record<string, number>>((counts, shape) => {
    counts[shape.type] = (counts[shape.type] ?? 0) + 1
    return counts
  }, {})
}
