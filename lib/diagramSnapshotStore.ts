import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DiagramSnapshot } from './diagramApiTypes'

const STORAGE_DIR = path.join(process.cwd(), '.diagramtalk')
const SNAPSHOT_PATH = path.join(STORAGE_DIR, 'diagram-snapshot.json')

type StoredDiagramSnapshot = {
  snapshot: DiagramSnapshot | null
  name: string | null
}

export async function getStoredDiagramSnapshot() {
  try {
    const [rawSnapshot, metadata] = await Promise.all([
      readFile(SNAPSHOT_PATH, 'utf8'),
      stat(SNAPSHOT_PATH),
    ])

    const parsedSnapshot = JSON.parse(rawSnapshot) as unknown
    const stored = normalizeStoredDiagramSnapshot(parsedSnapshot)

    return {
      snapshot: stored.snapshot,
      name: stored.name,
      updatedAt: metadata.mtime.toISOString(),
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        snapshot: null,
        name: null,
        updatedAt: null,
      }
    }

    throw error
  }
}

export async function saveDiagramSnapshot(updates: {
  snapshot?: DiagramSnapshot
  name?: string | null
}) {
  await mkdir(STORAGE_DIR, { recursive: true })

  const updatedAt = new Date().toISOString()
  const tempPath = `${SNAPSHOT_PATH}.${process.pid}.${Date.now()}.tmp`
  const currentSnapshot = await getCurrentStoredDiagramSnapshot()
  const nextSnapshot = updates.snapshot ?? currentSnapshot.snapshot
  const nextName =
    typeof updates.name === 'string'
      ? normalizeDiagramName(updates.name)
      : updates.name === null
        ? null
        : currentSnapshot.name
  const payload: StoredDiagramSnapshot = {
    snapshot: nextSnapshot,
    name: nextName,
  }

  await writeFile(tempPath, JSON.stringify(payload), 'utf8')
  await rename(tempPath, SNAPSHOT_PATH)

  return updatedAt
}

async function getCurrentStoredDiagramSnapshot(): Promise<StoredDiagramSnapshot> {
  try {
    const rawSnapshot = await readFile(SNAPSHOT_PATH, 'utf8')
    const parsedSnapshot = JSON.parse(rawSnapshot) as unknown

    return normalizeStoredDiagramSnapshot(parsedSnapshot)
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        snapshot: null,
        name: null,
      }
    }

    throw error
  }
}

function normalizeStoredDiagramSnapshot(value: unknown): StoredDiagramSnapshot {
  if (!value || typeof value !== 'object') {
    return {
      snapshot: null,
      name: null,
    }
  }

  const maybeRecord = value as Record<string, unknown>

  if ('snapshot' in maybeRecord || 'name' in maybeRecord) {
    return {
      snapshot: isDiagramSnapshot(maybeRecord.snapshot) ? maybeRecord.snapshot : null,
      name: normalizeStoredDiagramName(maybeRecord.name),
    }
  }

  return {
    snapshot: value as DiagramSnapshot,
    name: null,
  }
}

function isDiagramSnapshot(value: unknown): value is DiagramSnapshot {
  return !!value && typeof value === 'object'
}

function normalizeStoredDiagramName(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeDiagramName(value: string) {
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
