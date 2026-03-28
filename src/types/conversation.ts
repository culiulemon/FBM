export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  metadata?: Record<string, unknown>
}

export interface ConversationBuffer {
  messages: ConversationMessage[]
  startedAt: number
  lastActivityAt: number
  turnCount: number
}
