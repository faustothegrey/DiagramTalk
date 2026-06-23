import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { DiagramSnapshot } from './diagramApiTypes'

const STORAGE_DIR = path.join(process.cwd(), '.diagramtalk')
const SNAPSHOT_PATH = path.join(STORAGE_DIR, 'diagram-snapshot.json')

export async function getStoredDiagramSnapshot() {
  try {
    const [rawSnapshot, metadata] = await Promise.all([
      readFile(SNAPSHOT_PATH, 'utf8'),
      stat(SNAPSHOT_PATH),
    ])

    return {
      snapshot: JSON.parse(rawSnapshot) as DiagramSnapshot,
      updatedAt: metadata.mtime.toISOString(),
    }
  } catch (error) {
    if (isNotFoundError(error)) {
      return {
        snapshot: null,
        updatedAt: null,
      }
    }

    throw error
  }
}

export async function saveDiagramSnapshot(snapshot: DiagramSnapshot) {
  await mkdir(STORAGE_DIR, { recursive: true })

  const updatedAt = new Date().toISOString()
  const tempPath = `${SNAPSHOT_PATH}.${process.pid}.${Date.now()}.tmp`

  await writeFile(tempPath, JSON.stringify(snapshot), 'utf8')
  await rename(tempPath, SNAPSHOT_PATH)

  return updatedAt
}

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  )
}
