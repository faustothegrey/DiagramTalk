import type { Editor, TLShape } from 'tldraw'
import type { DiagramSelectionContext, DiagramShapeContext } from './types'

export function toDiagramShapeContext(shape: TLShape): DiagramShapeContext {
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x,
    y: shape.y,
    rotation: shape.rotation,
    props: shape.props,
  }
}

export function getSelectedDiagramContext(editor: Editor): DiagramSelectionContext {
  const shapes = editor.getSelectedShapes()

  return {
    shapeIds: shapes.map((shape) => shape.id),
    shapes: shapes.map(toDiagramShapeContext),
  }
}
