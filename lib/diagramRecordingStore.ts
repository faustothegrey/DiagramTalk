import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  DiagramRecording,
  DiagramRecordingSummary,
  HighlightInput,
  RecordingEventType,
  SetStateTagInput,
} from './diagramApiTypes'

const STORAGE_DIR = path.join(process.cwd(), '.diagramtalk')
const RECORDINGS_DIR = path.join(STORAGE_DIR, 'recordings')
const RECORDINGS_INDEX_PATH = path.join(STORAGE_DIR, 'recordings-index.json')

type StoredRecordingsIndex = {
  activeId: string | null
}

type AppendRecordingEventInput = {
  diagramId: string
  commandId: string
  type: RecordingEventType
  input: HighlightInput | SetStateTagInput
  occurredAt?: string
}

export async function listRecordings(): Promise<{
  activeId: string | null
  recordings: DiagramRecordingSummary[]
}> {
  await ensureRecordingsDir()
  const recordings = await readRecordings()
  const index = await readIndex()
  const activeId = resolveActiveId(index.activeId, recordings)
  if (activeId !== index.activeId) await writeIndex({ activeId })

  return {
    activeId,
    recordings: recordings.map(toSummary),
  }
}

export async function getRecording(id: string): Promise<DiagramRecording | null> {
  await ensureRecordingsDir()
  return readRecording(id)
}

export async function startRecording(input: {
  diagramId: string
  name?: string | null
}): Promise<DiagramRecording> {
  await ensureRecordingsDir()
  await endOpenRecordings()

  const now = new Date().toISOString()
  const recording: DiagramRecording = {
    id: randomUUID(),
    diagramId: input.diagramId,
    name: normalizeName(input.name),
    status: 'recording',
    startedAt: now,
    endedAt: null,
    eventCount: 0,
    events: [],
  }

  await writeRecording(recording)
  await writeIndex({ activeId: recording.id })
  return recording
}

async function endOpenRecordings() {
  const now = new Date().toISOString()
  const recordings = await readRecordings()
  const openRecordings = recordings.filter((recording) => recording.status === 'recording')

  await Promise.all(
    openRecordings.map((recording) =>
      writeRecording({
        ...recording,
        status: 'ended',
        endedAt: recording.endedAt ?? now,
      }),
    ),
  )

  if (openRecordings.length > 0) {
    await writeIndex({ activeId: null })
  }
}

export async function endRecording(id?: string): Promise<DiagramRecording | null> {
  await ensureRecordingsDir()
  const index = await readIndex()
  const recordingId = id ?? index.activeId
  if (!recordingId) return null

  const recording = await readRecording(recordingId)
  if (!recording) return null

  if (recording.status === 'recording') {
    recording.status = 'ended'
    recording.endedAt = new Date().toISOString()
    await writeRecording(recording)
  }

  if (index.activeId === recording.id) {
    await writeIndex({ activeId: null })
  }

  return recording
}

export async function appendRecordingEvent(input: AppendRecordingEventInput) {
  await ensureRecordingsDir()
  const index = await readIndex()
  if (!index.activeId) return null

  const recording = await readRecording(index.activeId)
  if (!recording || recording.status !== 'recording') return null
  if (recording.diagramId !== input.diagramId) return null

  const occurredAt = input.occurredAt ?? new Date().toISOString()
  const event = {
    id: randomUUID(),
    recordingId: recording.id,
    diagramId: input.diagramId,
    commandId: input.commandId,
    type: input.type,
    input: input.input,
    occurredAt,
    elapsedMs: Math.max(0, Date.parse(occurredAt) - Date.parse(recording.startedAt)),
  }

  recording.events.push(event)
  recording.eventCount = recording.events.length
  await writeRecording(recording)
  return event
}

function toSummary(recording: DiagramRecording): DiagramRecordingSummary {
  return {
    id: recording.id,
    diagramId: recording.diagramId,
    name: recording.name,
    status: recording.status,
    startedAt: recording.startedAt,
    endedAt: recording.endedAt,
    eventCount: recording.events.length,
  }
}

async function ensureRecordingsDir() {
  await mkdir(RECORDINGS_DIR, { recursive: true })
}

async function readRecordings(): Promise<DiagramRecording[]> {
  let entries: string[]
  try {
    entries = await readdir(RECORDINGS_DIR)
  } catch (error) {
    if (isNotFoundError(error)) return []
    throw error
  }

  const recordings: DiagramRecording[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    try {
      const recording = normalizeRecording(
        JSON.parse(await readFile(path.join(RECORDINGS_DIR, entry), 'utf8')) as unknown,
      )
      if (recording) recordings.push(recording)
    } catch (error) {
      console.error(`[diagramRecordingStore] Skipping unreadable recording file: ${entry}`, error)
    }
  }

  recordings.sort((a, b) => a.startedAt.localeCompare(b.startedAt))
  return recordings
}

async function readRecording(id: string) {
  try {
    const raw = await readFile(recordingFilePath(id), 'utf8')
    return normalizeRecording(JSON.parse(raw) as unknown)
  } catch (error) {
    if (isNotFoundError(error)) return null
    throw error
  }
}

async function writeRecording(recording: DiagramRecording) {
  await ensureRecordingsDir()
  await writeJsonAtomically(recordingFilePath(recording.id), recording)
}

async function readIndex(): Promise<StoredRecordingsIndex> {
  try {
    const raw = await readFile(RECORDINGS_INDEX_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    const activeId =
      parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).activeId === 'string'
        ? ((parsed as Record<string, unknown>).activeId as string)
        : null
    return { activeId }
  } catch (error) {
    if (isNotFoundError(error)) return { activeId: null }
    throw error
  }
}

async function writeIndex(index: StoredRecordingsIndex) {
  await mkdir(STORAGE_DIR, { recursive: true })
  await writeJsonAtomically(RECORDINGS_INDEX_PATH, index)
}

function resolveActiveId(stored: string | null, recordings: DiagramRecording[]) {
  if (stored && recordings.some((recording) => recording.id === stored && recording.status === 'recording')) {
    return stored
  }
  return recordings.find((recording) => recording.status === 'recording')?.id ?? null
}

function recordingFilePath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid recording id: ${id}`)
  }
  return path.join(RECORDINGS_DIR, `${id}.json`)
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(tempPath, JSON.stringify(value), 'utf8')
  await rename(tempPath, filePath)
}

function normalizeRecording(value: unknown): DiagramRecording | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return null
  if (typeof record.diagramId !== 'string' || record.diagramId.length === 0) return null
  if (record.status !== 'recording' && record.status !== 'ended') return null
  if (typeof record.startedAt !== 'string') return null

  const events = Array.isArray(record.events) ? record.events.flatMap(normalizeEvent) : []

  return {
    id: record.id,
    diagramId: record.diagramId,
    name: normalizeName(record.name),
    status: record.status,
    startedAt: record.startedAt,
    endedAt: typeof record.endedAt === 'string' ? record.endedAt : null,
    eventCount: events.length,
    events,
  }
}

function normalizeEvent(value: unknown) {
  if (!value || typeof value !== 'object') return []

  const event = value as Record<string, unknown>
  if (typeof event.id !== 'string') return []
  if (typeof event.recordingId !== 'string') return []
  if (typeof event.diagramId !== 'string') return []
  if (typeof event.commandId !== 'string') return []
  const type: RecordingEventType | null =
    event.type === 'highlight' || event.type === 'setStateTag' ? event.type : null
  if (!type) return []
  if (typeof event.occurredAt !== 'string') return []
  if (typeof event.elapsedMs !== 'number' || !Number.isFinite(event.elapsedMs)) return []
  if (!event.input || typeof event.input !== 'object') return []

  return [
    {
      id: event.id,
      recordingId: event.recordingId,
      diagramId: event.diagramId,
      commandId: event.commandId,
      type,
      input: event.input as HighlightInput | SetStateTagInput,
      occurredAt: event.occurredAt,
      elapsedMs: event.elapsedMs,
    },
  ]
}

function normalizeName(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return Boolean(error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT')
}
