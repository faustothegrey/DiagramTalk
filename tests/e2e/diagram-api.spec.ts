import { expect, test, type Page } from '@playwright/test'

type DiagramCommand = {
  id: string
  status: string
  error?: string
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
  await createDiagram(page, `Playwright Context ${Date.now()}`)
  await openWorkspace(page)

  const sourceId = `pw-source-${Date.now()}`
  const targetId = `pw-target-${Date.now()}`
  const edgeId = `pw-edge-${Date.now()}`

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
  const targetDiagramId = await createDiagram(page, `Playwright Target ${Date.now()}`)
  await createDiagram(page, `Playwright Other ${Date.now()}`)
  await openWorkspace(page)

  const shapeId = `pw-targeted-${Date.now()}`
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
  const diagramId = await createDiagram(page, `Playwright Save ${Date.now()}`)
  await openWorkspace(page)

  const shapeId = `pw-save-${Date.now()}`
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
  const diagramId = await createDiagram(page, `Playwright Render ${Date.now()}`)
  await openWorkspace(page)

  const shapeId = `pw-render-${Date.now()}`
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
  await createDiagram(page, `Playwright Camera ${Date.now()}`)
  await openWorkspace(page)

  const shapeCommand = await queueCommand(page, {
    type: 'createShape',
    input: {
      id: `pw-camera-${Date.now()}`,
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
  const diagramId = await createDiagram(page, `Playwright Highlight ${Date.now()}`)
  await openWorkspace(page)

  const shapeId = `pw-highlight-${Date.now()}`
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
      ids: [`missing-${Date.now()}`],
    },
  })
  await waitForCommand(page, missingCommand.id, 'failed')
  const failedCommand = await getCommand(page, missingCommand.id)
  expect(failedCommand?.error).toContain('Shape not found')
})
