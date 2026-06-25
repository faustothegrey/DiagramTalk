'use client'

import { FormEvent, useMemo, useState } from 'react'
import type { Editor } from 'tldraw'
import { SelectionSummary } from '@/components/SelectionSummary'
import { exportCurrentDiagramAsPdf, exportCurrentDiagramAsSvg } from '@/lib/diagramExport'
import type {
  ChatMessage,
  DiagramChatResponse,
  DiagramContext,
} from '@/lib/types'

type ChatPanelProps = {
  diagram: DiagramContext
  editor: Editor | null
  diagramName: string | null
  onDiagramNameChange: (name: string) => void
}

export function ChatPanel({ diagram, editor, diagramName, onDiagramNameChange }: ChatPanelProps) {
  const [activeTab, setActiveTab] = useState<'chat' | 'commands'>('chat')
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [activeExport, setActiveExport] = useState<'pdf' | 'svg' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const canSubmit = question.trim().length > 0 && !isLoading
  const canExport = activeExport === null

  const recentMessages = useMemo(
    () =>
      messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .slice(-6)
        .map((message) => ({
          role: message.role,
          content: message.content,
        })),
    [messages],
  )

  async function handleExport(format: 'pdf' | 'svg') {
    if (!editor) {
      setExportError('Diagram editor is not ready.')
      return
    }

    setActiveExport(format)
    setExportError(null)

    try {
      if (format === 'pdf') {
        await exportCurrentDiagramAsPdf(editor, diagramName)
      } else {
        await exportCurrentDiagramAsSvg(editor, diagramName)
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Export failed.'
      setExportError(message)
    } finally {
      setActiveExport(null)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const trimmedQuestion = question.trim()
    if (!trimmedQuestion || isLoading) return

    const userMessage = createMessage('user', trimmedQuestion)

    setMessages((current) => [...current, userMessage])
    setQuestion('')
    setIsLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question: trimmedQuestion,
          diagram,
          recentMessages,
        }),
      })

      const payload = (await response.json().catch(() => null)) as
        | DiagramChatResponse
        | { error?: string }
        | null

      if (!response.ok) {
        throw new Error(payload && 'error' in payload && payload.error ? payload.error : 'Request failed.')
      }

      if (!payload || !('answer' in payload)) {
        throw new Error('The assistant response was malformed.')
      }

      setMessages((current) => [...current, createMessage('assistant', payload.answer)])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to contact the assistant.'
      setMessages((current) => [...current, createMessage('error', message)])
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <aside className="chatPanel" aria-label="Diagram chat">
      <header className="chatHeader">
        <h1 className="chatTitle">Diagram Talk</h1>
        <p className="chatSubtitle">Chat with the diagram or manage exports and the diagram name.</p>
      </header>

      <div className="tabStrip" role="tablist" aria-label="Diagram Talk sections">
        <button
          aria-selected={activeTab === 'chat'}
          className={activeTab === 'chat' ? 'tabButton tabButtonActive' : 'tabButton'}
          onClick={() => setActiveTab('chat')}
          role="tab"
          type="button"
        >
          Chat
        </button>
        <button
          aria-selected={activeTab === 'commands'}
          className={activeTab === 'commands' ? 'tabButton tabButtonActive' : 'tabButton'}
          onClick={() => setActiveTab('commands')}
          role="tab"
          type="button"
        >
          Commands
        </button>
      </div>

      {activeTab === 'chat' ? (
        <>
          <SelectionSummary diagram={diagram} />

          <div className="messageList" aria-live="polite">
            {messages.length === 0 ? (
              <p className="emptyMessages">
                Draw a few shapes, select one, then ask whether the relationship or label makes sense.
              </p>
            ) : (
              messages.map((message) => (
                <article
                  className={[
                    'message',
                    message.role === 'user' ? 'messageUser' : '',
                    message.role === 'error' ? 'messageError' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  key={message.id}
                >
                  <div className="messageRole">{roleLabel(message.role)}</div>
                  <div className="messageBubble">{message.content}</div>
                </article>
              ))
            )}
            {isLoading ? (
              <article className="message">
                <div className="messageRole">Assistant</div>
                <div className="messageBubble">Thinking...</div>
              </article>
            ) : null}
          </div>

          <form className="chatForm" onSubmit={handleSubmit}>
            <textarea
              className="questionInput"
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="Ask about the selected shape or link..."
              value={question}
            />
            <div className="submitRow">
              <span className="submitHint">
                {diagram.selectedShapes.length === 0
                  ? 'Full diagram context will be sent.'
                  : 'Selection and diagram context will be sent.'}
              </span>
              <button className="submitButton" disabled={!canSubmit} type="submit">
                Send
              </button>
            </div>
          </form>
        </>
      ) : (
        <section className="commandsPanel" role="tabpanel">
          <div className="commandsGroup">
            <p className="commandsLabel">Diagram name</p>
            <input
              className="diagramNameInput diagramNameInputPanel"
              onChange={(event) => onDiagramNameChange(event.target.value)}
              placeholder="Untitled diagram"
              value={diagramName ?? ''}
            />
          </div>

          <div className="commandsGroup">
            <p className="commandsLabel">Export</p>
            <div className="exportControls">
              <button
                className="exportButton"
                disabled={!canExport}
                onClick={() => void handleExport('svg')}
                type="button"
              >
                {activeExport === 'svg' ? 'Exporting SVG...' : 'SVG'}
              </button>
              <button
                className="exportButton exportButtonPrimary"
                disabled={!canExport}
                onClick={() => void handleExport('pdf')}
                type="button"
              >
                {activeExport === 'pdf' ? 'Exporting PDF...' : 'PDF'}
              </button>
            </div>
            {exportError ? <p className="exportError">{exportError}</p> : null}
          </div>

          <div className="commandsGroup">
            <p className="commandsLabel">Automation</p>
            <div className="automationNotes">
              <p>
                Every canvas element has an id. Use the DiagramTalk CLI or REST API to create,
                connect, frame, save, render, pulse-highlight elements, and place live state tags
                in the open app tab. Record runs to persist timed highlight/tag events without
                changing the base diagram snapshot.
              </p>
              <code>python3 diagramtalk/scripts/diagramtalk.py highlight shape:example-node</code>
              <code>python3 diagramtalk/scripts/diagramtalk.py tag shape:waiting agent</code>
              <code>python3 diagramtalk/scripts/diagramtalk.py record start --name &quot;Agent run&quot;</code>
              <code>npm run test:e2e</code>
            </div>
          </div>
        </section>
      )}
    </aside>
  )
}

function createMessage(role: ChatMessage['role'], content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: new Date().toISOString(),
  }
}

function roleLabel(role: ChatMessage['role']) {
  if (role === 'user') return 'You'
  if (role === 'assistant') return 'Assistant'
  return 'Error'
}
