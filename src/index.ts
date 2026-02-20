/**
 * doradobet-agent — Entry Point
 *
 * Express HTTP server on port 3002 (AGENT_WEBHOOK_URL target).
 * Accepts POST /webhook from io-server and returns MODULE 5 JSON responses.
 */

import express from 'express'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { logConfig } from './infrastructure/config.js'
import { config } from './infrastructure/config.js'
import { getPool, closePool, runMigrations } from './infrastructure/db.js'
import { closeRedis } from './infrastructure/redis.js'
import { webhookHandler, healthHandler } from './server/webhook-handler.js'
import { startMcpServer } from './mcp/server.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main(): Promise<void> {
  // 1. Validate and log configuration
  logConfig()

  // 1b. Run DB migrations (idempotent — safe on every startup)
  await runMigrations()

  // 2. Create Express app
  const app = express()
  app.use(express.json({ limit: '1mb' }))
  app.disable('x-powered-by')

  // 3. Routes
  app.post('/webhook', webhookHandler)
  app.get('/health', healthHandler)

  // Demo UI: reset user profile (delete memory from PostgreSQL)
  app.delete('/api/reset-user', async (req, res) => {
    const userId = req.query['userId'] as string
    if (!userId) { res.status(400).json({ error: 'userId required' }); return }
    await getPool().query('DELETE FROM doradobet_memories WHERE user_id = $1', [userId])
    console.log(`[App] Reset profile for userId=${userId}`)
    res.json({ ok: true })
  })

  // Serve demo chat UI from /public
  const publicDir = join(__dirname, '..', 'public')
  app.use(express.static(publicDir))
  app.get('/chat', (_req, res) => res.sendFile(join(publicDir, 'index.html')))

  // 4. Start HTTP server
  const server = app.listen(config.PORT, () => {
    console.log(`[App] doradobet-agent listening on :${config.PORT}`)
    console.log(`[App] POST /webhook — main endpoint`)
    console.log(`[App] GET /health — health check`)
  })

  // 5. Start MCP server (for Altenar tools, used by other agents)
  let stopMcp: (() => Promise<void>) | null = null
  try {
    stopMcp = await startMcpServer(config.MCP_PORT)
  } catch (err) {
    console.warn('[App] MCP server failed to start (non-fatal):', err)
  }

  // 6. Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    console.log(`\n[App] Received ${signal} — shutting down gracefully...`)

    server.close(() => console.log('[App] HTTP server closed'))

    if (stopMcp) await stopMcp()
    await closePool()
    await closeRedis()

    console.log('[App] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('uncaughtException', (err) => {
    console.error('[App] Uncaught exception:', err)
    void shutdown('uncaughtException')
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[App] Unhandled rejection:', reason)
  })
}

main().catch((err) => {
  console.error('[App] Fatal startup error:', err)
  process.exit(1)
})
