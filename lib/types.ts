export type DiagramShapeContext = {
  id: string
  type: string
  props?: unknown
  x?: number
  y?: number
  rotation?: number
}

export type DiagramSelectionContext = {
  shapeIds: string[]
  shapes: DiagramShapeContext[]
}

export type ChatMessage = {
  id: string
  role: 'user' | 'assistant' | 'error'
  content: string
  createdAt: string
}

export type DiagramChatRequest = {
  question: string
  selection: DiagramSelectionContext
  recentMessages?: {
    role: 'user' | 'assistant'
    content: string
  }[]
}

export type DiagramChatResponse = {
  answer: string
}
