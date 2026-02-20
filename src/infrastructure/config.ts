/**
 * Centralized configuration with Zod validation.
 * Fails fast at startup if required env vars are missing.
 * Loads .env automatically in development via dotenv.
 */

import { config as dotenvLoad } from 'dotenv'
import { z } from 'zod'

// Load .env file before validation (no-op if already loaded or vars are set)
dotenvLoad()

const envSchema = z.object({
  // Anthropic
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  CLAUDE_MODEL: z.string().default('claude-sonnet-4-6'),

  // Database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // Altenar sports data API
  ALTENAR_API_URL: z.string().default('https://altenar-data-api-dev.onrender.com'),

  // Security: validates requests from io-server
  ODDS_API_KEY: z.string().min(1, 'ODDS_API_KEY is required'),

  // Server
  PORT: z.coerce.number().default(3002),
  MCP_PORT: z.coerce.number().default(3003),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

export type Config = z.infer<typeof envSchema>

function validateEnv(): Config {
  const result = envSchema.safeParse(process.env)
  if (!result.success) {
    console.error('[Config] Invalid or missing environment variables:')
    for (const [field, errors] of Object.entries(result.error.flatten().fieldErrors)) {
      console.error(`  ${field}: ${errors?.join(', ')}`)
    }
    process.exit(1)
  }
  return result.data
}

export const config = validateEnv()

export function logConfig(): void {
  console.log('[Config] ✅ Environment validated')
  console.log(`[Config] Model: ${config.CLAUDE_MODEL}`)
  console.log(`[Config] Port: ${config.PORT} | MCP port: ${config.MCP_PORT}`)
  console.log(`[Config] Altenar API: ${config.ALTENAR_API_URL}`)
  console.log(`[Config] Node env: ${config.NODE_ENV}`)
}
