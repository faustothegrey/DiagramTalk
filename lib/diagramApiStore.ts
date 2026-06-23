import type { DiagramCommand, DiagramCommandStatus } from './diagramApiTypes'
import type { DiagramContext } from './types'

type DiagramApiState = {
  context: DiagramContext | null
  contextUpdatedAt: string | null
  commands: DiagramCommand[]
}

const globalForDiagramApi = globalThis as typeof globalThis & {
  __diagramTalkApiState?: DiagramApiState
}

const state =
  globalForDiagramApi.__diagramTalkApiState ??
  (globalForDiagramApi.__diagramTalkApiState = {
    context: null,
    contextUpdatedAt: null,
    commands: [],
  })

export function getPublishedDiagramContext() {
  return {
    context: state.context,
    updatedAt: state.contextUpdatedAt,
  }
}

export function publishDiagramContext(context: DiagramContext) {
  const updatedAt = new Date().toISOString()

  state.context = context
  state.contextUpdatedAt = updatedAt

  return updatedAt
}

export function addDiagramCommand(command: DiagramCommand) {
  state.commands.push(command)
  return command
}

export function listDiagramCommands(status?: DiagramCommandStatus) {
  if (!status) return [...state.commands]
  return state.commands.filter((command) => command.status === status)
}

export function updateDiagramCommandResult(
  commandId: string,
  result:
    | {
        status: 'applied'
      }
    | {
        status: 'failed'
        error: string
      },
) {
  const command = state.commands.find((candidate) => candidate.id === commandId)

  if (!command) return null

  command.status = result.status
  command.appliedAt = new Date().toISOString()
  command.error = result.status === 'failed' ? result.error : undefined

  return command
}
