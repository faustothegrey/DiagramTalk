import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type {
  DiagramRecord,
  DiagramSnapshot,
  DiagramSummary,
} from './diagramApiTypes'

const STORAGE_DIR = path.join(process.cwd(), '.diagramtalk')
const DIAGRAMS_DIR = path.join(STORAGE_DIR, 'diagrams')
const INDEX_PATH = path.join(STORAGE_DIR, 'index.json')
const LEGACY_SNAPSHOT_PATH = path.join(STORAGE_DIR, 'diagram-snapshot.json')

type StoredIndex = {
  activeId: string | null
}

// Storage is initialized lazily and only once per process: the diagrams
// directory is created and any legacy single-diagram snapshot is migrated into
// the new per-diagram layout.
let initPromise: Promise<void> | null = null

function init() {
  if (!initPromise) {
    initPromise = doInit().catch((error) => {
      // Reset so a transient failure can be retried on the next call.
      initPromise = null
      throw error
    })
  }
  return initPromise
}

async function doInit() {
  await mkdir(DIAGRAMS_DIR, { recursive: true })

  const existing = await readDiagramRecords()
  if (existing.length > 0) return

  const legacy = await readLegacySnapshot()
  if (!legacy) return

  const now = new Date().toISOString()
  const record: DiagramRecord = {
    id: randomUUID(),
    name: legacy.name,
    snapshot: legacy.snapshot,
    createdAt: now,
    updatedAt: now,
  }

  await writeDiagramRecord(record)
  await writeIndex({ activeId: record.id })
  await rename(LEGACY_SNAPSHOT_PATH, `${LEGACY_SNAPSHOT_PATH}.migrated`).catch(() => {})
}

export async function listDiagrams(): Promise<{
  activeId: string | null
  diagrams: DiagramSummary[]
}> {
  await init()
  const records = await readDiagramRecords()
  const index = await readIndex()

  return {
    activeId: resolveActiveId(index.activeId, records),
    diagrams: records.map(toSummary),
  }
}

export async function getDiagram(id: string): Promise<DiagramRecord | null> {
  await init()
  const records = await readDiagramRecords()
  return records.find((record) => record.id === id) ?? null
}

export async function getActiveDiagram(): Promise<DiagramRecord | null> {
  await init()
  const records = await readDiagramRecords()
  const index = await readIndex()
  const activeId = resolveActiveId(index.activeId, records)

  if (!activeId) return null
  return records.find((record) => record.id === activeId) ?? null
}

export async function createDiagram(input: {
  name?: string | null
  snapshot?: DiagramSnapshot | null
}): Promise<DiagramRecord> {
  await init()
  const now = new Date().toISOString()
  const record: DiagramRecord = {
    id: randomUUID(),
    name: normalizeName(input.name),
    snapshot: input.snapshot ?? null,
    createdAt: now,
    updatedAt: now,
  }

  await writeDiagramRecord(record)
  // A freshly created diagram becomes the active one.
  await writeIndex({ activeId: record.id })

  return record
}

export async function updateDiagram(
  id: string,
  updates: {
    name?: string | null
    snapshot?: DiagramSnapshot
    active?: boolean
  },
): Promise<DiagramRecord | null> {
  await init()
  const records = await readDiagramRecords()
  const current = records.find((record) => record.id === id)
  if (!current) return null

  const next: DiagramRecord = {
    ...current,
    name: updates.name !== undefined ? normalizeName(updates.name) : current.name,
    snapshot: updates.snapshot !== undefined ? updates.snapshot : current.snapshot,
    updatedAt: new Date().toISOString(),
  }

  await writeDiagramRecord(next)

  if (updates.active) {
    await writeIndex({ activeId: id })
  }

  return next
}

export async function setActiveDiagram(id: string): Promise<boolean> {
  await init()
  const records = await readDiagramRecords()
  if (!records.some((record) => record.id === id)) return false

  await writeIndex({ activeId: id })
  return true
}

export async function deleteDiagram(id: string): Promise<{
  deleted: boolean
  activeId: string | null
}> {
  await init()
  const records = await readDiagramRecords()
  const index = await readIndex()

  if (!records.some((record) => record.id === id)) {
    return { deleted: false, activeId: resolveActiveId(index.activeId, records) }
  }

  await rm(diagramFilePath(id), { force: true })
  const remaining = records.filter((record) => record.id !== id)

  let activeId = index.activeId
  if (activeId === id || !remaining.some((record) => record.id === activeId)) {
    // Fall back to the most recently created remaining diagram.
    activeId = remaining.length > 0 ? remaining[remaining.length - 1].id : null
    await writeIndex({ activeId })
  }

  return { deleted: true, activeId: resolveActiveId(activeId, remaining) }
}

function resolveActiveId(stored: string | null, records: DiagramRecord[]): string | null {
  if (stored && records.some((record) => record.id === stored)) return stored
  if (records.length === 0) return null

  // No valid pointer stored — fall back to the most recently updated diagram.
  return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].id
}

function diagramFilePath(id: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error(`Invalid diagram id: ${id}`)
  }
  return path.join(DIAGRAMS_DIR, `${id}.json`)
}

async function readDiagramRecords(): Promise<DiagramRecord[]> {
  let entries: string[]
  try {
    entries = await readdir(DIAGRAMS_DIR)
  } catch (error) {
    if (isNotFoundError(error)) return []
    throw error
  }

  const records: DiagramRecord[] = []
  for (const entry of entries) {
    if (!entry.endsWith('.json')) continue

    try {
      const raw = await readFile(path.join(DIAGRAMS_DIR, entry), 'utf8')
      const record = normalizeRecord(JSON.parse(raw) as unknown)
      if (record) records.push(record)
    } catch (error) {
      console.error(`[diagramStore] Skipping unreadable diagram file: ${entry}`, error)
    }
  }

  records.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return records
}

async function writeDiagramRecord(record: DiagramRecord) {
  await mkdir(DIAGRAMS_DIR, { recursive: true })
  await writeJsonAtomically(diagramFilePath(record.id), record)
}

async function readIndex(): Promise<StoredIndex> {
  try {
    const raw = await readFile(INDEX_PATH, 'utf8')
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

async function writeIndex(index: StoredIndex) {
  await mkdir(STORAGE_DIR, { recursive: true })
  await writeJsonAtomically(INDEX_PATH, index)
}

async function readLegacySnapshot(): Promise<{
  snapshot: DiagramSnapshot | null
  name: string | null
} | null> {
  try {
    const raw = await readFile(LEGACY_SNAPSHOT_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown

    if (!parsed || typeof parsed !== 'object') return null

    const record = parsed as Record<string, unknown>
    if ('snapshot' in record || 'name' in record) {
      return {
        snapshot: isObject(record.snapshot) ? (record.snapshot as DiagramSnapshot) : null,
        name: normalizeName(record.name),
      }
    }

    // Older format: the file is the raw snapshot.
    return { snapshot: parsed as DiagramSnapshot, name: null }
  } catch (error) {
    if (isNotFoundError(error)) return null
    console.error('[diagramStore] Failed to read legacy snapshot for migration.', error)
    return null
  }
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tempPath, JSON.stringify(value), 'utf8')
  await rename(tempPath, filePath)
}

function normalizeRecord(value: unknown): DiagramRecord | null {
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) return null

  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date(0).toISOString()

  return {
    id: record.id,
    name: normalizeName(record.name),
    snapshot: isObject(record.snapshot) ? (record.snapshot as DiagramSnapshot) : null,
    createdAt,
    updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : createdAt,
  }
}

function toSummary(record: DiagramRecord): DiagramSummary {
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
