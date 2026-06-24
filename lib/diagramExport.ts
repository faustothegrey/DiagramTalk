'use client'

import { PDFDocument } from 'pdf-lib'
import type { Editor, TLShapeId } from 'tldraw'

const POINTS_PER_PIXEL = 72 / 96

export async function exportCurrentDiagramAsSvg(editor: Editor, diagramName?: string | null) {
  const shapeIds = getCurrentDiagramShapeIds(editor)
  const exportResult = await getSvgExport(editor, shapeIds)
  const svg = exportResult.svg
  const filename = buildExportFilename('svg', diagramName)

  downloadTextFile(svg, filename, 'image/svg+xml')
}

export async function exportCurrentDiagramAsPdf(editor: Editor, diagramName?: string | null) {
  const shapeIds = getCurrentDiagramShapeIds(editor)
  const imageResult = await editor.toImage(shapeIds, {
    format: 'png',
    background: true,
    darkMode: false,
    scale: 1,
  })
  const pngData = await imageResult.blob.arrayBuffer()

  const pdf = await PDFDocument.create()
  const png = await pdf.embedPng(pngData)
  const page = pdf.addPage([png.width * POINTS_PER_PIXEL, png.height * POINTS_PER_PIXEL])

  page.drawImage(png, {
    x: 0,
    y: 0,
    width: page.getWidth(),
    height: page.getHeight(),
  })

  const bytes = await pdf.save()
  const filename = buildExportFilename('pdf', diagramName)

  downloadBytesFile(bytes, filename, 'application/pdf')
}

function getCurrentDiagramShapeIds(editor: Editor): TLShapeId[] {
  return [...editor.getCurrentPageShapeIds()]
}

async function getSvgExport(editor: Editor, shapeIds: TLShapeId[]) {
  const options = {
    background: true,
    darkMode: false,
    scale: 1,
  }

  const svgEditor = editor as Editor & {
    getSvgString(ids: TLShapeId[], opts: typeof options): Promise<{ svg: string } | null>
  }
  const exportResult = await svgEditor.getSvgString(shapeIds, options)

  if (!exportResult) {
    throw new Error('Could not construct SVG export.')
  }

  return exportResult as { svg: string }
}

function buildExportFilename(extension: 'pdf' | 'svg', diagramName?: string | null) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const namePart = sanitizeFileNamePart(diagramName)

  if (!namePart) {
    return `diagramtalk-snapshot-${timestamp}.${extension}`
  }

  return `${namePart}-${timestamp}.${extension}`
}

function sanitizeFileNamePart(value?: string | null) {
  if (!value) return null

  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  return sanitized.length > 0 ? sanitized : null
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  downloadBlob(blob, filename)
}

function downloadBytesFile(content: Uint8Array, filename: string, mimeType: string) {
  const buffer = content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer
  const blob = new Blob([buffer], { type: mimeType })
  downloadBlob(blob, filename)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
