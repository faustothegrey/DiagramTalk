export const DIAGRAM_STATE_TAG_EVENT = 'diagramtalk:state-tag'

export type StateTagColor = 'blue' | 'green' | 'yellow' | 'red' | 'violet' | 'grey'

export type DiagramStateTagEventDetail =
  | {
      clear: true
      tagId: string
    }
  | {
      clear?: false
      tagId: string
      shapeId: string
      label: string
      color: StateTagColor
    }
