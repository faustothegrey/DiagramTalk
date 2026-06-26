import type { DiagramContext } from './types'
import type { HighlightColor } from './diagramHighlight'
import type { StateTagColor } from './diagramStateTags'

export type DiagramSnapshot = unknown

export type ShapeColor =
  | 'black'
  | 'grey'
  | 'light-violet'
  | 'violet'
  | 'blue'
  | 'light-blue'
  | 'yellow'
  | 'orange'
  | 'green'
  | 'light-green'
  | 'light-red'
  | 'red'
  | 'white'

export type ShapeFill = 'none' | 'semi' | 'solid' | 'pattern'

export type ConnectionAnchor = 'top' | 'bottom' | 'left' | 'right' | 'center'

// 'straight' (default) draws a direct anchor-to-anchor arrow; 'orthogonal'
// renders a tldraw elbow arrow that bends in axis-aligned segments, which keeps
// long-range / back edges out of intermediate boxes.
export type ConnectionRouting = 'straight' | 'orthogonal'

export type CreateShapeInput = {
  id?: string
  type: 'box' | 'ellipse' | 'text' | 'note'
  label?: string
  x: number
  y: number
  w?: number
  h?: number
  color?: ShapeColor
  fill?: ShapeFill
}

export type CreateConnectionInput = {
  id?: string
  fromShapeId: string
  toShapeId: string
  label?: string
  directional?: boolean
  // Which side of the source/target shape the arrow attaches to. Defaults to
  // 'center' (legacy behavior). Picking sides keeps arrows out of box interiors.
  fromAnchor?: ConnectionAnchor
  toAnchor?: ConnectionAnchor
  color?: ShapeColor
  // Defaults to 'straight'. 'orthogonal' renders an elbow arrow.
  routing?: ConnectionRouting
}

// Camera is a view-only operation; it never mutates or persists shapes.
//  - 'fit'      zoom to fit all content, centered (optional padding px).
//  - 'topLeft'  frame content near the viewport's top-left, leaving the
//               right/bottom open (optional margin px; optional explicit zoom).
//  - 'absolute' set the camera directly (page x/y + zoom).
export type SetCameraInput =
  | { mode: 'fit'; padding?: number }
  | { mode: 'topLeft'; margin?: number; zoom?: number }
  | { mode: 'absolute'; x: number; y: number; zoom: number }

export type HighlightInput = {
  ids: string[]
  color?: HighlightColor
  durationMs?: number
  padding?: number
}

export type SetStateTagInput = {
  shapeId?: string
  label?: string
  tagId?: string
  color?: StateTagColor
  clear?: boolean
}

export type StartRecordingInput = {
  name?: string | null
}

export type EndRecordingInput = {
  id?: string
}

export type DiagramCommandStatus = 'pending' | 'applied' | 'failed'

type DiagramCommandBase = {
  id: string
  status: DiagramCommandStatus
  createdAt: string
  appliedAt?: string
  error?: string
  // The diagram this command targets. When omitted the command applies to the
  // active diagram (legacy behavior); when set, the browser bridge switches to
  // that diagram to apply it (auto-activate).
  diagramId?: string
}

export type CreateShapeCommand = DiagramCommandBase & {
  type: 'createShape'
  input: CreateShapeInput
}

export type CreateConnectionCommand = DiagramCommandBase & {
  type: 'createConnection'
  input: CreateConnectionInput
}

export type ClearDiagramCommand = DiagramCommandBase & {
  type: 'clearDiagram'
}

export type SetCameraCommand = DiagramCommandBase & {
  type: 'setCamera'
  input: SetCameraInput
}

export type HighlightCommand = DiagramCommandBase & {
  type: 'highlight'
  input: HighlightInput
}

export type SetStateTagCommand = DiagramCommandBase & {
  type: 'setStateTag'
  input: SetStateTagInput
}

export type RecordingCommandResult = {
  recordingId: string
  activeId: string | null
}

export type StartRecordingCommand = DiagramCommandBase & {
  type: 'startRecording'
  input?: StartRecordingInput
  result: RecordingCommandResult
}

export type EndRecordingCommand = DiagramCommandBase & {
  type: 'endRecording'
  input?: EndRecordingInput
  result: RecordingCommandResult
}

export type DiagramCommand =
  | CreateShapeCommand
  | CreateConnectionCommand
  | ClearDiagramCommand
  | SetCameraCommand
  | HighlightCommand
  | SetStateTagCommand
  | StartRecordingCommand
  | EndRecordingCommand

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

// Every command request may carry an optional `diagramId` to target a specific
// diagram instead of the active one.
export type CreateDiagramCommandRequest =
  | {
      type: 'createShape'
      input: CreateShapeInput
      diagramId?: string
    }
  | {
      type: 'createConnection'
      input: CreateConnectionInput
      diagramId?: string
    }
  | {
      type: 'clearDiagram'
      diagramId?: string
    }
  | {
      type: 'setCamera'
      input: SetCameraInput
      diagramId?: string
    }
  | {
      type: 'highlight'
      input: HighlightInput
      diagramId?: string
    }
  | {
      type: 'setStateTag'
      input: SetStateTagInput
      diagramId?: string
    }
  | {
      type: 'startRecording'
      input?: StartRecordingInput
      diagramId?: string
    }
  | {
      type: 'endRecording'
      input?: EndRecordingInput
      diagramId?: string
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

export type RecordingStatus = 'recording' | 'ended'

export type RecordingEventType = 'highlight' | 'setStateTag'

export type RecordingEvent = {
  id: string
  recordingId: string
  diagramId: string
  commandId: string
  type: RecordingEventType
  input: HighlightInput | SetStateTagInput
  occurredAt: string
  elapsedMs: number
}

export type DiagramRecordingSummary = {
  id: string
  diagramId: string
  name: string | null
  status: RecordingStatus
  startedAt: string
  endedAt: string | null
  eventCount: number
}

export type DiagramRecording = DiagramRecordingSummary & {
  events: RecordingEvent[]
}

export type ListRecordingsResponse = {
  activeId: string | null
  recordings: DiagramRecordingSummary[]
}

export type StartRecordingRequest = {
  diagramId?: string
  name?: string | null
}

export type RecordingResponse = {
  recording: DiagramRecording
  activeId: string | null
}

export type EndRecordingRequest = {
  id?: string
}

export type AskDiagramRequest = {
  question: string
}

export type AskDiagramResponse = {
  answer: string
  contextUpdatedAt: string | null
}

export type GetDiagramSnapshotResponse = {
  id: string | null
  snapshot: DiagramSnapshot | null
  name: string | null
  updatedAt: string | null
}

export type PublishDiagramSnapshotRequest = {
  // When omitted, the currently active diagram is updated.
  id?: string
  snapshot?: DiagramSnapshot
  name?: string | null
}

export type PublishDiagramSnapshotResponse = {
  ok: true
  updatedAt: string
}

export type RenderFormat = 'png' | 'svg'

export type RequestRenderRequest = {
  id?: string
  format?: RenderFormat
}

export type RequestRenderResponse = {
  id: string
  format: RenderFormat
  requestedAt: string
}

export type UploadRenderRequest = {
  id: string
  format: RenderFormat
  data: string
}

export type UploadRenderResponse = {
  ok: true
  renderedAt: string
}

export type RequestSaveRequest = {
  id?: string
}

export type RequestSaveResponse = {
  id: string
  requestedAt: string
}

export type SaveMetaResponse = {
  id: string
  savedAt: string | null
  request: {
    id: string
    requestedAt: string
  } | null
}

export type RenderMetaResponse = {
  id: string
  format: RenderFormat | null
  renderedAt: string | null
  request: {
    id: string
    format: RenderFormat
    requestedAt: string
  } | null
}

export type DiagramSummary = {
  id: string
  name: string | null
  createdAt: string
  updatedAt: string
}

export type DiagramRecord = DiagramSummary & {
  snapshot: DiagramSnapshot | null
}

export type ListDiagramsResponse = {
  activeId: string | null
  diagrams: DiagramSummary[]
}

export type CreateDiagramRequest = {
  name?: string | null
}

export type UpdateDiagramRequest = {
  name?: string | null
  snapshot?: DiagramSnapshot
  // Set to true to make this diagram the active one.
  active?: boolean
}

export type DiagramRecordResponse = {
  diagram: DiagramRecord
  activeId: string | null
}

export type DeleteDiagramResponse = {
  deleted: boolean
  activeId: string | null
}
