import type { DiagramContext } from './types'

export type CreateShapeInput = {
  id?: string
  type: 'box' | 'ellipse' | 'text' | 'note'
  label?: string
  x: number
  y: number
  w?: number
  h?: number
}

export type CreateConnectionInput = {
  id?: string
  fromShapeId: string
  toShapeId: string
  label?: string
  directional?: boolean
}

export type DiagramCommandStatus = 'pending' | 'applied' | 'failed'

type DiagramCommandBase = {
  id: string
  status: DiagramCommandStatus
  createdAt: string
  appliedAt?: string
  error?: string
}

export type CreateShapeCommand = DiagramCommandBase & {
  type: 'createShape'
  input: CreateShapeInput
}

export type CreateConnectionCommand = DiagramCommandBase & {
  type: 'createConnection'
  input: CreateConnectionInput
}

export type DiagramCommand = CreateShapeCommand | CreateConnectionCommand

export type GetDiagramContextResponse = {
  context: DiagramContext | null
  updatedAt: string | null
}

export type PublishDiagramContextRequest = {
  context: DiagramContext
}

export type PublishDiagramContextResponse = {
  ok: true
  updatedAt: string
}

export type CreateDiagramCommandRequest =
  | {
      type: 'createShape'
      input: CreateShapeInput
    }
  | {
      type: 'createConnection'
      input: CreateConnectionInput
    }

export type CreateDiagramCommandResponse = {
  command: DiagramCommand
}

export type ListDiagramCommandsResponse = {
  commands: DiagramCommand[]
}

export type DiagramCommandResultRequest =
  | {
      status: 'applied'
    }
  | {
      status: 'failed'
      error: string
    }

export type DiagramCommandResultResponse = {
  command: DiagramCommand
}

export type AskDiagramRequest = {
  question: string
}

export type AskDiagramResponse = {
  answer: string
  contextUpdatedAt: string | null
}
