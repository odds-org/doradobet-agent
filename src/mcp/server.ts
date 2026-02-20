/**
 * MCP HTTP Server — port 3003
 *
 * Exposes Altenar tools via the Model Context Protocol (MCP) for use by
 * other agents (e.g., claude-agent-sdk based agents). The doradobet-agent
 * itself calls Altenar directly, but this MCP server makes the tools
 * available for future integrations.
 *
 * Tools:
 *   - buscar_eventos_en_vivo    → live sports events
 *   - buscar_eventos_programados → upcoming sports events
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { config } from '../infrastructure/config.js'

async function callAltenar(query: string): Promise<string> {
  const response = await fetch(`${config.ALTENAR_API_URL}/api/v1/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) {
    return `Error ${response.status} consultando Altenar para: "${query}"`
  }
  const data = await response.json() as { results: unknown[]; total_results: number }
  return JSON.stringify(data)
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'doradobet-tools',
    version: '1.0.0',
  })

  server.tool(
    'buscar_eventos_en_vivo',
    'Busca eventos deportivos que están ocurriendo EN ESTE MOMENTO con sus cuotas actuales.',
    {
      query: z
        .string()
        .describe(
          'Consulta en lenguaje natural. Incluye deporte y/o equipos. Ej: "partidos NBA en vivo ahora"'
        ),
    },
    async ({ query }) => {
      const result = await callAltenar(`${query} en vivo live`)
      return { content: [{ type: 'text', text: result }] }
    }
  )

  server.tool(
    'buscar_eventos_programados',
    'Busca eventos deportivos programados (hoy, mañana, esta semana) con sus cuotas.',
    {
      query: z
        .string()
        .describe(
          'Consulta en lenguaje natural con deporte y fecha. Ej: "próximos partidos NBA mañana"'
        ),
    },
    async ({ query }) => {
      const result = await callAltenar(`${query} próximos programados`)
      return { content: [{ type: 'text', text: result }] }
    }
  )

  return server
}

/**
 * Start the MCP HTTP server on a given port.
 * Returns a cleanup function.
 */
export async function startMcpServer(
  port: number = config.MCP_PORT
): Promise<() => Promise<void>> {
  const { createServer } = await import('http')
  const mcpServer = createMcpServer()
  const transports = new Map<string, StreamableHTTPServerTransport>()

  const httpServer = createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/mcp') {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        onsessioninitialized: (sessionId: string) => {
          transports.set(sessionId, transport)
        },
      })

      transport.onclose = () => {
        const sessionId = transport.sessionId
        if (sessionId) transports.delete(sessionId)
      }

      await mcpServer.connect(transport)
      await transport.handleRequest(req, res)
    } else if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', tools: ['buscar_eventos_en_vivo', 'buscar_eventos_programados'] }))
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  })

  await new Promise<void>((resolve) => httpServer.listen(port, resolve))
  console.log(`[MCP] Server listening on port ${port}`)

  return async () => {
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()))
    })
    console.log('[MCP] Server stopped')
  }
}
