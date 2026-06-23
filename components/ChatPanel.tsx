'use client'

import { FormEvent, useMemo, useState } from 'react'
import { SelectionSummary } from '@/components/SelectionSummary'
import type {
  ChatMessage,
  DiagramChatResponse,
  DiagramContext,
} from '@/lib/types'

type ChatPanelProps = {
  diagram: DiagramContext
}

export function ChatPanel({ diagram }: ChatPanelProps) {
  const [question, setQuestion] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const canSubmit = question.trim().length > 0 && !isLoading

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
        <h1 className="chatTitle">Diagram Chat</h1>
        <p className="chatSubtitle">Ask about the selected part of the diagram.</p>
      </header>

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
