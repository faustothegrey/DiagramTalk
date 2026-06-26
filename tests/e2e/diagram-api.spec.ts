import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

type DiagramCommand = {
  id: string
  status: string
  error?: string
  result?: {
    recordingId?: string
    activeId?: string | null
  }
}

type DiagramContextShape = {
  id: string
  label?: string
}

type DiagramContextConnection = {
  arrowId: string
  startShapeId: string | null
  endShapeId: string | null
}

type DiagramContextResponse = {
  context: {
    shapes: DiagramContextShape[]
    connections: DiagramContextConnection[]
  } | null
}

function toShapeId(id: string) {
  return id.startsWith('shape:') ? id : `shape:${id}`
}

function uniqueId(prefix: string) {
  return `${prefix}-${randomUUID()}`
}

async function createDiagram(page: Page, name: string) {
  const response = await page.request.post('/api/diagrams', { data: { name } })
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as { activeId: string }
  return payload.activeId
}

async function openWorkspace(page: Page) {
  await page.goto('/')
  await expect(page.getByLabel('Whiteboard')).toBeVisible({ timeout: 15_000 })
}

async function queueCommand(page: Page, payload: Record<string, unknown>) {
  const response = await page.request.post('/api/diagram/commands', { data: payload })
  expect(response.status()).toBe(201)
  const body = (await response.json()) as { command: DiagramCommand }
  return body.command
}

async function getCommand(page: Page, commandId: string) {
  const response = await page.request.get('/api/diagram/commands')
  const payload = (await response.json()) as { commands: DiagramCommand[] }
  return payload.commands.find((candidate) => candidate.id === commandId) ?? null
}

async function waitForCommand(page: Page, commandId: string, expectedStatus = 'applied') {
  await expect
    .poll(async () => {
      const command = await getCommand(page, commandId)
      if (command?.status === 'failed' && expectedStatus !== 'failed') {
        throw new Error(command.error ?? `Command failed: ${commandId}`)
      }
      return command?.status
    })
    .toBe(expectedStatus)
}

async function waitForShapeInContext(page: Page, shapeId: string) {
  const resolvedId = toShapeId(shapeId)

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/diagram/context')
      const payload = (await response.json()) as DiagramContextResponse
      return payload.context?.shapes.some((shape) => shape.id === resolvedId) ?? false
    })
    .toBe(true)
}

async function requestSave(page: Page, diagramId: string) {
  const response = await page.request.post('/api/diagram/save', { data: { id: diagramId } })
  expect(response.status()).toBe(202)
  const requested = (await response.json()) as { requestedAt: string }

  await expect
    .poll(async () => {
      const metaResponse = await page.request.get(`/api/diagram/save?id=${diagramId}`)
      const meta = (await metaResponse.json()) as { savedAt: string | null }
      return meta.savedAt && meta.savedAt >= requested.requestedAt
    })
    .toBeTruthy()
}

async function requestRender(page: Page, diagramId: string, format: 'png' | 'svg') {
  const response = await page.request.post('/api/diagram/render', {
    data: { id: diagramId, format },
  })
  expect(response.status()).toBe(202)
  const requested = (await response.json()) as { requestedAt: string }

  await expect
    .poll(async () => {
      const metaResponse = await page.request.get(`/api/diagram/render?id=${diagramId}&meta=1`)
      const meta = (await metaResponse.json()) as {
        format: string | null
        renderedAt: string | null
      }
      return meta.format === format && meta.renderedAt && meta.renderedAt >= requested.requestedAt
    })
    .toBeTruthy()

  return page.request.get(`/api/diagram/render?id=${diagramId}`)
}

async function getSnapshotShapeIds(page: Page) {
  const response = await page.request.get('/api/diagram/snapshot')
  expect(response.ok()).toBeTruthy()
  const payload = (await response.json()) as {
    snapshot: { document?: { store?: Record<string, unknown> } } | null
  }
  return Object.keys(payload.snapshot?.document?.store ?? {}).filter((key) =>
    key.startsWith('shape:'),
  )
}

test.describe.configure({ mode: 'serial' })

test('creates shapes and connections through the browser bridge', async ({ page }) => {
  await createDiagram(page, uniqueId('Playwright Context'))
  await openWorkspace(page)

  const sourceId = uniqueId('pw-source')
  const targetId = uniqueId('pw-target')
  const edgeId = uniqueId('pw-edge')

  for (const [id, x] of [
    [sourceId, 120],
    [targetId, 380],
  ] as const) {
    const command = await queueCommand(page, {
      type: 'createShape',
      input: {
        id,
        type: 'box',
        label: id,
        x,
        y: 140,
        w: 160,
        h: 90,
      },
    })
    await waitForCommand(page, command.id)
  }

  const connectCommand = await queueCommand(page, {
    type: 'createConnection',
    input: {
      id: edgeId,
      fromShapeId: sourceId,
      toShapeId: targetId,
      label: 'calls',
      fromAnchor: 'right',
      toAnchor: 'left',
    },
  })
  await waitForCommand(page, connectCommand.id)

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/diagram/context')
      const payload = (await response.json()) as DiagramContextResponse
      return {
        hasSource: payload.context?.shapes.some((shape) => shape.id === toShapeId(sourceId)),
        hasTarget: payload.context?.shapes.some((shape) => shape.id === toShapeId(targetId)),
        hasEdge: payload.context?.connections.some(
          (connection) =>
            connection.arrowId === toShapeId(edgeId) &&
            connection.startShapeId === toShapeId(sourceId) &&
            connection.endShapeId === toShapeId(targetId),
        ),
      }
    })
    .toEqual({ hasSource: true, hasTarget: true, hasEdge: true })
})

test('auto-activates a targeted diagram before applying a command', async ({ page }) => {
  const targetDiagramId = await createDiagram(page, uniqueId('Playwright Target'))
  await createDiagram(page, uniqueId('Playwright Other'))
  await openWorkspace(page)

  const shapeId = uniqueId('pw-targeted')
  const command = await queueCommand(page, {
    type: 'createShape',
    diagramId: targetDiagramId,
    input: {
      id: shapeId,
      type: 'ellipse',
      label: 'Targeted',
      x: 160,
      y: 180,
      w: 170,
      h: 90,
    },
  })
  await waitForCommand(page, command.id)
  await waitForShapeInContext(page, shapeId)

  await expect
    .poll(async () => {
      const response = await page.request.get('/api/diagrams')
      const payload = (await response.json()) as { activeId: string | null }
      return payload.activeId
    })
    .toBe(targetDiagramId)
})

test('explicit save persists the current snapshot', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright Save'))
  await openWorkspace(page)

  const shapeId = uniqueId('pw-save')
  const command = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: shapeId,
      type: 'box',
      label: 'Save me',
      x: 140,
      y: 160,
      w: 180,
      h: 90,
    },
  })
  await waitForCommand(page, command.id)
  await requestSave(page, diagramId)

  const snapshotShapeIds = await getSnapshotShapeIds(page)
  expect(snapshotShapeIds).toContain(toShapeId(shapeId))
})

test('renders non-empty PNG and SVG exports', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright Render'))
  await openWorkspace(page)

  const shapeId = uniqueId('pw-render')
  const command = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: shapeId,
      type: 'box',
      label: 'Render me',
      x: 140,
      y: 160,
      w: 180,
      h: 90,
      color: 'green',
      fill: 'semi',
    },
  })
  await waitForCommand(page, command.id)

  const pngResponse = await requestRender(page, diagramId, 'png')
  expect(pngResponse.headers()['content-type']).toContain('image/png')
  expect((await pngResponse.body()).length).toBeGreaterThan(100)

  const svgResponse = await requestRender(page, diagramId, 'svg')
  expect(svgResponse.headers()['content-type']).toContain('image/svg+xml')
  expect(await svgResponse.text()).toContain('<svg')
})

test('camera commands change the live viewport transform', async ({ page }) => {
  await createDiagram(page, uniqueId('Playwright Camera'))
  await openWorkspace(page)

  const shapeCommand = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: uniqueId('pw-camera'),
      type: 'box',
      label: 'Camera target',
      x: 240,
      y: 220,
      w: 180,
      h: 90,
    },
  })
  await waitForCommand(page, shapeCommand.id)

  const beforeTransform = await page
    .locator('.tl-html-layer')
    .evaluate((element) => getComputedStyle(element).transform)

  const cameraCommand = await queueCommand(page, {
    type: 'setCamera',
    input: {
      mode: 'absolute',
      x: -160,
      y: -120,
      zoom: 1.4,
    },
  })
  await waitForCommand(page, cameraCommand.id)

  await expect
    .poll(async () =>
      page.locator('.tl-html-layer').evaluate((element) => getComputedStyle(element).transform),
    )
    .not.toBe(beforeTransform)
})

test('highlights existing shapes and fails cleanly for missing ids', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright Highlight'))
  await openWorkspace(page)

  const shapeId = uniqueId('pw-highlight')
  const createCommand = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: shapeId,
      type: 'box',
      label: 'Highlight target',
      x: 160,
      y: 140,
      w: 180,
      h: 90,
      color: 'blue',
      fill: 'semi',
    },
  })
  await waitForCommand(page, createCommand.id)
  await requestSave(page, diagramId)
  const beforeHighlightShapeIds = await getSnapshotShapeIds(page)

  const highlightCommand = await queueCommand(page, {
    type: 'highlight',
    input: {
      ids: [shapeId],
      color: 'blue',
      durationMs: 1800,
    },
  })
  await waitForCommand(page, highlightCommand.id)
  await expect(page.locator('.diagramHighlightPulse')).toBeVisible()

  await requestSave(page, diagramId)
  const afterHighlightShapeIds = await getSnapshotShapeIds(page)
  expect(afterHighlightShapeIds.sort()).toEqual(beforeHighlightShapeIds.sort())

  const missingCommand = await queueCommand(page, {
    type: 'highlight',
    input: {
      ids: [uniqueId('missing')],
    },
  })
  await waitForCommand(page, missingCommand.id, 'failed')
  const failedCommand = await getCommand(page, missingCommand.id)
  expect(failedCommand?.error).toContain('Shape not found')
})

test('state tags move between box states and stay out of snapshots', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright State Tag'))
  await openWorkspace(page)

  const waitingId = uniqueId('pw-waiting')
  const doneId = uniqueId('pw-done')
  const nonBoxId = uniqueId('pw-nonbox')

  for (const shape of [
    { id: waitingId, type: 'box', label: 'Waiting', x: 120 },
    { id: doneId, type: 'box', label: 'Done', x: 420 },
    { id: nonBoxId, type: 'ellipse', label: 'Actor', x: 720 },
  ] as const) {
    const command = await queueCommand(page, {
      type: 'createShape',
      input: {
        id: shape.id,
        type: shape.type,
        label: shape.label,
        x: shape.x,
        y: 160,
        w: 170,
        h: 90,
      },
    })
    await waitForCommand(page, command.id)
  }

  await requestSave(page, diagramId)
  const beforeTagShapeIds = await getSnapshotShapeIds(page)

  const firstTagCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      shapeId: waitingId,
      label: 'agent',
      tagId: 'agent-1',
      color: 'blue',
    },
  })
  await waitForCommand(page, firstTagCommand.id)

  const tag = page.locator('.diagramStateTag')
  await expect(tag).toHaveText('agent')
  await expect(tag).toBeVisible()
  const firstBox = await tag.boundingBox()
  expect(firstBox).not.toBeNull()

  const moveTagCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      shapeId: doneId,
      label: 'agent',
      tagId: 'agent-1',
      color: 'green',
    },
  })
  await waitForCommand(page, moveTagCommand.id)
  await expect(tag).toHaveCount(1)

  await expect
    .poll(async () => {
      const currentBox = await tag.boundingBox()
      return currentBox && firstBox ? currentBox.x > firstBox.x + 100 : false
    })
    .toBe(true)

  await requestSave(page, diagramId)
  const afterTagShapeIds = await getSnapshotShapeIds(page)
  expect(afterTagShapeIds.sort()).toEqual(beforeTagShapeIds.sort())

  const nonBoxTagCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      shapeId: nonBoxId,
      label: 'agent',
      tagId: 'agent-2',
    },
  })
  await waitForCommand(page, nonBoxTagCommand.id, 'failed')
  const failedCommand = await getCommand(page, nonBoxTagCommand.id)
  expect(failedCommand?.error).toContain('State tag target must be a box shape')

  const clearCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      tagId: 'agent-1',
      clear: true,
    },
  })
  await waitForCommand(page, clearCommand.id)
  await expect(tag).toHaveCount(0)
})

test('records highlight and state-tag events with timestamps', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright Recording'))
  await openWorkspace(page)

  const firstStateId = uniqueId('pw-recording-first')
  const secondStateId = uniqueId('pw-recording-second')

  for (const shape of [
    { id: firstStateId, label: 'First', x: 140 },
    { id: secondStateId, label: 'Second', x: 420 },
  ] as const) {
    const command = await queueCommand(page, {
      type: 'createShape',
      input: {
        id: shape.id,
        type: 'box',
        label: shape.label,
        x: shape.x,
        y: 170,
        w: 170,
        h: 90,
      },
    })
    await waitForCommand(page, command.id)
  }

  const startResponse = await page.request.post('/api/diagram/recordings', {
    data: {
      diagramId,
      name: 'Agent run',
    },
  })
  expect(startResponse.status()).toBe(201)
  const started = (await startResponse.json()) as {
    activeId: string
    recording: { id: string; startedAt: string }
  }
  expect(started.activeId).toBe(started.recording.id)

  const blockedSaveResponse = await page.request.post('/api/diagram/save', {
    data: { id: diagramId },
  })
  expect(blockedSaveResponse.status()).toBe(409)
  expect(await blockedSaveResponse.json()).toMatchObject({
    recordingId: started.recording.id,
  })

  const liveOnlyShapeId = uniqueId('pw-recording-live-only')
  const liveOnlyCommand = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: liveOnlyShapeId,
      type: 'box',
      label: 'Live only during recording',
      x: 700,
      y: 170,
      w: 190,
      h: 90,
    },
  })
  await waitForCommand(page, liveOnlyCommand.id)

  await page.waitForTimeout(1500)
  await expect
    .poll(async () => {
      const snapshotShapeIds = await getSnapshotShapeIds(page)
      return snapshotShapeIds.includes(toShapeId(liveOnlyShapeId))
    })
    .toBe(false)

  const highlightCommand = await queueCommand(page, {
    type: 'highlight',
    input: {
      ids: [firstStateId],
      color: 'yellow',
      durationMs: 1200,
    },
  })
  await waitForCommand(page, highlightCommand.id)

  const firstTagCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      shapeId: firstStateId,
      label: 'agent',
      tagId: 'agent-1',
      color: 'blue',
    },
  })
  await waitForCommand(page, firstTagCommand.id)

  const secondTagCommand = await queueCommand(page, {
    type: 'setStateTag',
    input: {
      shapeId: secondStateId,
      label: 'agent',
      tagId: 'agent-1',
      color: 'green',
    },
  })
  await waitForCommand(page, secondTagCommand.id)

  const endResponse = await page.request.patch('/api/diagram/recordings/active', { data: {} })
  expect(endResponse.ok()).toBeTruthy()
  const ended = (await endResponse.json()) as {
    activeId: string | null
    recording: {
      id: string
      diagramId: string
      status: string
      startedAt: string
      endedAt: string | null
      eventCount: number
      events: Array<{
        commandId: string
        diagramId: string
        type: string
        occurredAt: string
        elapsedMs: number
        input: Record<string, unknown>
      }>
    }
  }

  expect(ended.activeId).toBeNull()
  expect(ended.recording.id).toBe(started.recording.id)
  expect(ended.recording.diagramId).toBe(diagramId)
  expect(ended.recording.status).toBe('ended')
  expect(ended.recording.endedAt).not.toBeNull()
  expect(ended.recording.eventCount).toBe(3)
  expect(ended.recording.events.map((event) => event.commandId)).toEqual([
    highlightCommand.id,
    firstTagCommand.id,
    secondTagCommand.id,
  ])
  expect(ended.recording.events.map((event) => event.type)).toEqual([
    'highlight',
    'setStateTag',
    'setStateTag',
  ])

  for (const event of ended.recording.events) {
    expect(event.diagramId).toBe(diagramId)
    expect(Date.parse(event.occurredAt)).toBeGreaterThanOrEqual(Date.parse(started.recording.startedAt))
    expect(event.elapsedMs).toBeGreaterThanOrEqual(0)
  }

  expect(ended.recording.events[0].input.ids).toEqual([firstStateId])
  expect(ended.recording.events[1].input.shapeId).toBe(firstStateId)
  expect(ended.recording.events[2].input.shapeId).toBe(secondStateId)

  const showResponse = await page.request.get(`/api/diagram/recordings/${started.recording.id}`)
  expect(showResponse.ok()).toBeTruthy()
  const shown = (await showResponse.json()) as { recording: { eventCount: number } }
  expect(shown.recording.eventCount).toBe(3)
})

test('starts and ends recordings as first-class diagram commands', async ({ page }) => {
  const diagramId = await createDiagram(page, uniqueId('Playwright Command Recording'))

  const startCommand = await queueCommand(page, {
    type: 'startRecording',
    diagramId,
    input: {
      name: 'Command-started run',
    },
  })

  expect(startCommand.status).toBe('applied')
  expect(startCommand.result?.recordingId).toBeTruthy()
  expect(startCommand.result?.activeId).toBe(startCommand.result?.recordingId)

  const activeResponse = await page.request.get('/api/diagram/recordings/active')
  expect(activeResponse.ok()).toBeTruthy()
  const active = (await activeResponse.json()) as {
    recording: { id: string; diagramId: string; name: string | null; status: string }
  }
  expect(active.recording.id).toBe(startCommand.result?.recordingId)
  expect(active.recording.diagramId).toBe(diagramId)
  expect(active.recording.name).toBe('Command-started run')
  expect(active.recording.status).toBe('recording')

  const endCommand = await queueCommand(page, {
    type: 'endRecording',
    diagramId,
  })

  expect(endCommand.status).toBe('applied')
  expect(endCommand.result?.recordingId).toBe(startCommand.result?.recordingId)
  expect(endCommand.result?.activeId).toBeNull()

  const showResponse = await page.request.get(`/api/diagram/recordings/${startCommand.result?.recordingId}`)
  expect(showResponse.ok()).toBeTruthy()
  const shown = (await showResponse.json()) as {
    activeId: string | null
    recording: { id: string; status: string; endedAt: string | null }
  }
  expect(shown.activeId).toBeNull()
  expect(shown.recording.id).toBe(startCommand.result?.recordingId)
  expect(shown.recording.status).toBe('ended')
  expect(shown.recording.endedAt).not.toBeNull()
})
