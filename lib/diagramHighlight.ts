export const DIAGRAM_HIGHLIGHT_EVENT = 'diagramtalk:highlight'

export type HighlightColor = 'yellow' | 'blue' | 'green' | 'red' | 'violet'

export type DiagramHighlightEventDetail = {
  ids: string[]
  color: HighlightColor
  durationMs: number
  padding: number
}
