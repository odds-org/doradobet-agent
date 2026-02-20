/**
 * Redis client — used for request deduplication.
 * Keyed by correlationId with a 5-minute TTL.
 */

import { createClient } from 'redis'
import { config } from './config.js'

type RedisClient = ReturnType<typeof createClient>

let client: RedisClient | null = null
let connecting = false

export async function getRedisClient(): Promise<RedisClient> {
  if (client?.isReady) return client

  if (connecting) {
    // Wait for connection to complete
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (client?.isReady) {
          clearInterval(check)
          resolve()
        }
      }, 50)
    })
    return client!
  }

  connecting = true
  client = createClient({ url: config.REDIS_URL })
  client.on('error', (err) => console.error('[Redis] Error:', err))
  client.on('reconnecting', () => console.log('[Redis] Reconnecting...'))
  await client.connect()
  connecting = false
  console.log('[Redis] Connected')
  return client
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit()
    client = null
    console.log('[Redis] Disconnected')
  }
}

/**
 * Deduplication: returns true if correlationId was already processed.
 * Records the ID with a 5-minute TTL to prevent double-processing.
 */
export async function isDuplicate(correlationId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient()
    const key = `dedup:doradobet:${correlationId}`
    const existing = await redis.get(key)
    if (existing) return true
    await redis.set(key, '1', { EX: 300 }) // 5 min TTL
    return false
  } catch (err) {
    console.warn('[Redis] Dedup check failed (allowing request):', err)
    return false // Fail open — better to process twice than to block
  }
}
