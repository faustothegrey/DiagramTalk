export type DiagramShapeContext = {
  id: string
  type: string
  label?: string
  props?: unknown
  x?: number
  y?: number
  rotation?: number
  bounds?: {
    x: number
    y: number
    w: number
    h: number
  }
}

export type DiagramBindingContext = {
  id: string
  type: string
  fromId: string
  toId: string
  terminal?: 'start' | 'end'
  props?: unknown
}

export type DiagramConnectionContext = {
  arrowId: string
  arrowLabel?: string
  startShapeId: string | null
  startShapeLabel?: string
  endShapeId: string | null
  endShapeLabel?: string
  arrowheadStart?: string
  arrowheadEnd?: string
  isDirectional: boolean
}

export type DiagramContext = {
  selectedShapeIds: string[]
  selectedShapes: DiagramShapeContext[]
  selectedConnections: DiagramConnectionContext[]
  shapes: DiagramShapeContext[]
  bindings: DiagramBindingContext[]
  connections: DiagramConnectionContext[]
  summary: {
    shapeCount: number
    connectionCount: number
    selectedShapeCount: number
    shapeTypes: Record<string, number>
  }
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  createdAt: string
}

export type DiagramChatRequest = {
  question: string
  diagram: DiagramContext
  recentMessages?: {
    role: 'user' | 'assistant'
    content: string
  }[]
}

export type DiagramChatResponse = {
  answer: string
}
