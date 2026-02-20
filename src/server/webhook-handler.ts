/**
 * Webhook Handler — POST /webhook
 *
 * Receives messages from io-server and returns MODULE 5 JSON responses.
 *
 * Request flow:
 *   1. Validate x-odds-api-key header
 *   2. Check for duplicate correlationId (Redis dedup)
 *   3. Build enriched context
 *   4. Run agent
 *   5. Format response as MODULE 5
 *   6. Return JSON
 */

import type { Request, Response } from 'express'
import { z } from 'zod'
import { config } from '../infrastructure/config.js'
import { isDuplicate } from '../infrastructure/redis.js'
import { memoryBackend } from '../memory/pg-memory-backend.js'
import { buildContext } from '../context/builder.js'
import { runAgent } from '../runtime/agent-runner.js'
import { formatResponse, serializeResponse } from './response-formatter.js'

// Validate incoming webhook payload
const WebhookSchema = z.object({
  message: z.string().default(''),
  userId: z.string().min(1, 'userId is required'),
  sessionId: z.string().min(1, 'sessionId is required'),
  clientId: z.string().min(1, 'clientId is required'),
  correlationId: z.string().min(1, 'correlationId is required'),
  context: z
    .array(z.object({ role: z.string(), content: z.string() }))
    .default([]),
  firstMessage: z.boolean().default(false),
  agentName: z.string().optional(),
})

export async function webhookHandler(req: Request, res: Response): Promise<void> {
  const requestStart = Date.now()

  // 1. Auth: validate API key
  const apiKey = req.headers['x-odds-api-key']
  if (apiKey !== config.ODDS_API_KEY) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  // 2. Parse body
  const parseResult = WebhookSchema.safeParse(req.body)
  if (!parseResult.success) {
    console.warn('[Webhook] Invalid payload:', parseResult.error.flatten())
    res.status(400).json({ error: 'Invalid payload', details: parseResult.error.flatten() })
    return
  }
  const payload = parseResult.data

  console.log(
    `[Webhook] → userId=${payload.userId} | correlationId=${payload.correlationId} | firstMsg=${payload.firstMessage} | msg="${payload.message.slice(0, 60)}"`
  )

  // 3. Dedup check
  if (await isDuplicate(payload.correlationId)) {
    console.log(`[Webhook] Duplicate request: ${payload.correlationId}`)
    res.status(200).json({ type: 'text', data: { message: '' } })
    return
  }

  try {
    // 4. Check if user has a memory file (determines which skill to use)
    const hasMemoryFile = await memoryBackend.exists(payload.userId)

    // 5. Build enriched context
    const ctx = buildContext(payload, hasMemoryFile)

    // 6. Run agent
    const result = await runAgent(ctx)

    console.log(
      `[Webhook] ← userId=${payload.userId} | skills=${result.skillsUsed.join(',')} | tools=${result.toolCallsCount} | ${result.durationMs}ms`
    )

    // 7. Format and return MODULE 5 response
    const module5 = formatResponse(result.output)
    res.status(200).json(module5)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[Webhook] Error for userId=${payload.userId}:`, message)

    // Fallback MODULE 5 text response on error
    res.status(200).json({
      type: 'text',
      data: { message: 'Hubo un problema procesando tu solicitud. Por favor intenta de nuevo.' },
    })
  }

  const totalMs = Date.now() - requestStart
  if (totalMs > 15_000) {
    console.warn(`[Webhook] Slow request: ${totalMs}ms for userId=${payload.userId}`)
  }
}

export async function healthHandler(_req: Request, res: Response): Promise<void> {
  const { healthCheck } = await import('../infrastructure/db.js')
  const dbOk = await healthCheck()
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    db: dbOk ? 'connected' : 'error',
    uptime: process.uptime(),
  })
}
