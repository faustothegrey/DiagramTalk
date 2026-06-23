import type { DiagramSelectionContext } from './types'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4.5'

type GenerateDiagramAnswerInput = {
  question: string
  selection: DiagramSelectionContext
}

type OpenRouterResponse = {
  choices?: {
    message?: {
      content?: string
    }
  }[]
  error?: {
    message?: string
  }
}

export async function generateDiagramAnswer({
  question,
  selection,
}: GenerateDiagramAnswerInput): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not configured.')
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'DiagramTalk',
    },
    body: JSON.stringify({
      model: process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'You are DiagramTalk, an assistant that helps reason about diagrams.\n\n' +
            'The user selected part of a tldraw diagram and asked a question.\n' +
            'Answer based only on the provided diagram context.\n' +
            'If the context is insufficient, say what additional diagram information would help.\n' +
            'Be concise, practical, and explicit about uncertainty.\n' +
            'Do not claim to see diagram elements that are not present in the provided context.\n' +
            'Do not suggest canvas edits unless the user asks for edits.',
        },
        {
          role: 'user',
          content:
            `User question:\n${question}\n\n` +
            `Selected diagram context:\n${JSON.stringify(selection, null, 2)}`,
        },
      ],
    }),
  })

  const body = (await response.json().catch(() => null)) as OpenRouterResponse | null

  if (!response.ok) {
    const message = body?.error?.message ?? `OpenRouter request failed with ${response.status}.`
    throw new Error(message)
  }

  const answer = body?.choices?.[0]?.message?.content?.trim()

  if (!answer) {
    throw new Error('OpenRouter returned an empty response.')
  }

  return answer
}
