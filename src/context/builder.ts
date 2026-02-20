/**
 * Context Builder — enriches the raw webhook payload with runtime context.
 * Determines firstMessageOfDay, current Bogotá time, etc.
 */

export interface UserContext {
  userId: string
  sessionId: string
  clientId: string
  correlationId: string
  message: string
  context: ConversationTurn[]
  firstMessage: boolean
  agentName: string
  // Enriched at build time
  hasMemoryFile: boolean
  isFirstMessageOfDay: boolean
  bogotaDate: string
  bogotaTime: string
}

export interface ConversationTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface WebhookPayload {
  message: string
  userId: string
  sessionId: string
  clientId: string
  correlationId: string
  context?: Array<{ role: string; content: string }>
  firstMessage: boolean
  agentName?: string
}

const BOGOTA_TIMEZONE = 'America/Bogota'

export function buildContext(
  payload: WebhookPayload,
  hasMemoryFile: boolean
): UserContext {
  const now = new Date()

  const bogotaDate = now.toLocaleDateString('es-CO', {
    timeZone: BOGOTA_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const bogotaTime = now.toLocaleTimeString('es-CO', {
    timeZone: BOGOTA_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
  })

  // Proactive briefing = first message AND before noon Bogotá time
  const hourStr = now.toLocaleTimeString('es-CO', {
    timeZone: BOGOTA_TIMEZONE,
    hour: '2-digit',
    hour12: false,
  })
  const hour = parseInt(hourStr, 10)
  const isFirstMessageOfDay = payload.firstMessage && hour < 12

  const context: ConversationTurn[] = (payload.context ?? []).map((turn) => ({
    role: (turn.role === 'assistant' ? 'assistant' : 'user') as 'user' | 'assistant',
    content: turn.content,
  }))

  return {
    userId: payload.userId,
    sessionId: payload.sessionId,
    clientId: payload.clientId,
    correlationId: payload.correlationId,
    message: payload.message ?? '',
    context,
    firstMessage: payload.firstMessage,
    agentName: payload.agentName ?? 'Paul',
    hasMemoryFile,
    isFirstMessageOfDay,
    bogotaDate,
    bogotaTime,
  }
}
