/**
 * Agent Runner — the cognitive core of doradobet-agent.
 *
 * Uses the raw Anthropic SDK (not claude-agent-sdk) to:
 *   1. Enable beta tools: memory_20250818 + web_search_20260209
 *   2. Handle memory tool calls → PostgreSQL via PgMemoryBackend
 *   3. Handle Altenar tool calls → Altenar Data API directly
 *   4. Loop until the agent produces a MODULE 5 response
 *
 * Architecture decision: raw Anthropic SDK is used (not claude-agent-sdk)
 * because beta tools (memory, web_search) are API-level features that require
 * direct control over the agentic loop.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { MessageParam } from '@anthropic-ai/sdk/resources/index.js'
import { config } from '../infrastructure/config.js'
import { memoryBackend } from '../memory/pg-memory-backend.js'
import { assemblePrompt } from '../context/prompt-assembler.js'
import { activateSkills } from '../context/skill-activator.js'
import { auditToolCall } from '../hooks/audit-logger.js'
import type { UserContext } from '../context/builder.js'

const anthropic = new Anthropic({ apiKey: config.ANTHROPIC_API_KEY })

// Maximum agentic loop turns before giving up
const MAX_TURNS = 10

// ─── Tool Definitions ────────────────────────────────────────────────────────

// Web search is server-side (Anthropic executes it) — no handler needed on our side

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOL_DEFINITIONS: any[] = [
  // Native web search — SERVER-SIDE, Anthropic executes it automatically.
  // Requires beta: 'code-execution-web-tools-2026-02-09'
  // web_search_20250305 = sin dynamic filtering → mucho más rápido (~5-10s vs 3min)
  // Cambia a web_search_20260209 + beta code-execution-web-tools-2026-02-09
  // si necesitas filtrado avanzado (research técnico, documentación)
  {
    type: 'web_search_20250305',
    name: 'web_search',
    max_uses: 5,
  },

  // Memory tool — custom implementation backed by PostgreSQL.
  // Same interface as Anthropic's planned native memory tool (memory_20250818)
  // so migration will be seamless when it launches.
  {
    name: 'memory',
    description:
      'Accede y modifica el archivo de memoria del usuario. Guarda y recupera preferencias deportivas, nombre, equipos favoritos y otros datos persistentes del usuario entre sesiones.',
    input_schema: {
      type: 'object' as const,
      properties: {
        command: {
          type: 'string',
          enum: ['view', 'create', 'str_replace', 'find', 'delete'],
          description:
            'view=leer, create=crear/sobreescribir, str_replace=editar campo específico, find=buscar texto, delete=eliminar',
        },
        path: {
          type: 'string',
          description:
            'Ruta del archivo. SIEMPRE usar /memories/user-{userId} con el userId del CONTEXTO DE SESIÓN.',
        },
        file_text: {
          type: 'string',
          description: 'Contenido completo del archivo. Requerido solo para: create',
        },
        old_str: {
          type: 'string',
          description: 'Texto exacto a reemplazar. Requerido solo para: str_replace',
        },
        new_str: {
          type: 'string',
          description: 'Texto nuevo. Requerido solo para: str_replace',
        },
        pattern: {
          type: 'string',
          description: 'Texto a buscar. Requerido solo para: find',
        },
      },
      required: ['command', 'path'],
    },
  },

  // Altenar: live events
  {
    name: 'buscar_eventos_en_vivo',
    description:
      'Busca eventos deportivos que están ocurriendo EN ESTE MOMENTO. Retorna partidos en vivo con sus cuotas actuales. Usa este tool cuando el usuario pregunte por "en vivo", "ahora", "live" o quiera ver partidos que están jugándose.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Consulta en lenguaje natural. Incluye deporte y/o equipos si los conoces del perfil del usuario. Ejemplo: "partidos NBA en vivo ahora", "fútbol europeo en vivo"',
        },
      },
      required: ['query'],
    },
  },

  // Altenar: upcoming events
  {
    name: 'buscar_eventos_programados',
    description:
      'Busca eventos deportivos programados (hoy, mañana, esta semana). Retorna próximos partidos con sus cuotas. Usa este tool cuando el usuario pregunte por "hoy", "mañana", "próximos", fechas específicas o quiera planear apuestas futuras.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Consulta en lenguaje natural. Incluye deporte, fecha y/o equipos. Ejemplo: "próximos partidos NBA mañana", "fútbol hoy Premier League"',
        },
      },
      required: ['query'],
    },
  },
]

// ─── Altenar Tool Handlers ───────────────────────────────────────────────────

async function callAltenarAPI(query: string, userId: string): Promise<string> {
  try {
    const response = await fetch(`${config.ALTENAR_API_URL}/api/v1/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Trace-ID': userId,
      },
      body: JSON.stringify({
        query,
        top_k: 20,
        min_score: 0.5,
        max_odds_per_event: 7,
      }),
      signal: AbortSignal.timeout(10_000),
    })

    if (!response.ok) {
      console.error(`[Altenar] HTTP ${response.status} for query: "${query}"`)
      return `No se encontraron resultados en Altenar para: "${query}". Intenta con web_search como alternativa.`
    }

    const data = (await response.json()) as {
      query: string
      results: AltenarEvent[]
      total_results: number
    }

    if (!data.results || data.results.length === 0) {
      return `No hay eventos disponibles para: "${query}".`
    }

    return formatAltenarResults(data.results, query)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Altenar] Error for user ${userId}:`, message)
    return `Error consultando Altenar: ${message}. Usa web_search como fallback.`
  }
}

interface AltenarEvent {
  event_id: number
  event_name: string
  sport_name: string
  champ_name: string
  category_name: string
  status: string
  is_live: boolean
  start_date: string
  score: number
  odds: Array<{
    selection_id: number
    selection_name: string
    market_id: number
    market_name: string
    market_type_name: string
    price: number
  }>
}

function formatAltenarResults(events: AltenarEvent[], query: string): string {
  const lines: string[] = [
    `Se encontraron ${events.length} evento(s) para "${query}":\n`,
  ]

  for (const event of events) {
    const liveTag = event.is_live ? ' [EN VIVO 🔴]' : ''
    lines.push(`▶ ${event.event_name}${liveTag}`)
    lines.push(
      `   Deporte: ${event.sport_name} | Competición: ${event.champ_name} (${event.category_name})`
    )
    lines.push(`   Fecha: ${event.start_date} | Estado: ${event.status}`)
    lines.push(
      `   EventID: ${event.event_id} | URL: https://vsft.virtualsoft.tech/sport/${event.sport_name.toLowerCase()}/${event.event_id}`
    )

    if (event.odds && event.odds.length > 0) {
      const top = event.odds.slice(0, 3)
      lines.push(`   Cuotas principales:`)
      for (const odd of top) {
        lines.push(`     - ${odd.selection_name} (${odd.market_name}): ${odd.price.toFixed(2)}`)
      }
    }
    lines.push('')
  }

  return lines.join('\n')
}

async function handleLiveEvents(
  input: { query: string },
  userId: string
): Promise<string> {
  const query = `${input.query} en vivo live`
  return callAltenarAPI(query, userId)
}

async function handleUpcomingEvents(
  input: { query: string },
  userId: string
): Promise<string> {
  const query = `${input.query} próximos programados`
  return callAltenarAPI(query, userId)
}

// ─── Tool Dispatcher ─────────────────────────────────────────────────────────

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

async function dispatchToolCall(
  toolUse: ToolUseBlock,
  ctx: UserContext
): Promise<string | null> {
  const start = Date.now()

  auditToolCall({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    toolName: toolUse.name,
    toolInput: toolUse.input,
  })

  let result: string | null = null

  switch (toolUse.name) {
    case 'memory':
      result = await memoryBackend.handleToolCall(toolUse.input)
      break

    case 'buscar_eventos_en_vivo':
      result = await handleLiveEvents(toolUse.input as { query: string }, ctx.userId)
      break

    case 'buscar_eventos_programados':
      result = await handleUpcomingEvents(toolUse.input as { query: string }, ctx.userId)
      break

    default:
      result = `Tool "${toolUse.name}" is not implemented.`
  }

  const durationMs = Date.now() - start
  auditToolCall({
    userId: ctx.userId,
    sessionId: ctx.sessionId,
    toolName: `${toolUse.name}:complete`,
    toolInput: { result_length: result?.length ?? 0 },
    durationMs,
  })

  return result
}

// ─── Agent Loop ───────────────────────────────────────────────────────────────

export interface AgentResult {
  output: string
  toolCallsCount: number
  skillsUsed: string[]
  durationMs: number
}

export async function runAgent(ctx: UserContext): Promise<AgentResult> {
  const startTime = Date.now()
  let toolCallsCount = 0

  // 1. Determine active skill based on context
  const { skills, reason } = activateSkills({
    hasMemoryFile: ctx.hasMemoryFile,
    isFirstMessageOfDay: ctx.isFirstMessageOfDay,
    message: ctx.message,
  })
  console.log(`[AgentRunner] Skills: ${skills.join(', ')} — ${reason}`)

  // 2. Build system prompt (layered: identity + ways + skill + context)
  const systemPrompt = assemblePrompt(ctx, skills)

  // 3. Build initial conversation
  const userMessage = ctx.message.trim() || '(modo proactivo — sin mensaje del usuario)'
  const messages: MessageParam[] = [{ role: 'user', content: userMessage }]

  // 4. Agentic loop
  let output = ''

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    console.log(`[AgentRunner] Turn ${turn + 1}/${MAX_TURNS}`)

    const response = await anthropic.beta.messages.create({
      model: config.CLAUDE_MODEL,
      max_tokens: 4096,
      betas: ['web-search-2025-03-05'],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      tools: TOOL_DEFINITIONS as any,
      system: systemPrompt,
      messages,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const responseContent = (response as any).content as any[]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stopReason = (response as any).stop_reason as string | null

    // Append assistant turn (always — needed for multi-turn web search context)
    messages.push({ role: 'assistant', content: responseContent })

    if (stopReason === 'end_turn') {
      // Extract text blocks only (skip server_tool_use, web_search_tool_result, etc.)
      const textParts = responseContent
        .filter((b: any) => b.type === 'text' && b.text)
        .map((b: any) => b.text as string)
      output = textParts.join('')
      console.log(`[AgentRunner] Completed in turn ${turn + 1}. Output length: ${output.length}`)
      console.log(`[AgentRunner] Raw output: ${output.slice(0, 300)}`)
      break
    }

    // pause_turn = API paused a long-running search; continue without adding user message
    if (stopReason === 'pause_turn') {
      console.log('[AgentRunner] pause_turn — continuing search...')
      continue
    }

    if (stopReason === 'tool_use') {
      // Process client-side tool calls (memory, Altenar)
      // server_tool_use blocks (web_search) are handled by Anthropic — skip them
      const toolResults: Anthropic.ToolResultBlockParam[] = []

      for (const block of responseContent) {
        if (block.type !== 'tool_use') continue  // skip server_tool_use

        toolCallsCount++
        const toolUse = block as ToolUseBlock
        console.log(`[AgentRunner] Tool call: ${toolUse.name}`)

        const result = await dispatchToolCall(toolUse, ctx)

        if (result !== null) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id,
            content: result,
          })
        }
      }

      if (toolResults.length > 0) {
        messages.push({ role: 'user', content: toolResults })
      }
      continue
    }

    console.warn(`[AgentRunner] Unexpected stop_reason: ${stopReason}`)
    break
  }

  if (!output) {
    output = JSON.stringify({
      type: 'text',
      data: {
        message:
          'Tuve un problema procesando tu solicitud. Por favor intenta de nuevo.',
      },
    })
  }

  return {
    output,
    toolCallsCount,
    skillsUsed: skills,
    durationMs: Date.now() - startTime,
  }
}
