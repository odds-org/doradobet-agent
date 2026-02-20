/**
 * PostgreSQL connection pool — singleton.
 * SSL is enabled in production (Render) and disabled locally.
 */

import pg from 'pg'
import { config } from './config.js'

const { Pool } = pg

let pool: pg.Pool | null = null

export function getPool(): pg.Pool {
  if (!pool) {
    const isProduction = config.NODE_ENV === 'production'
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: isProduction ? { rejectUnauthorized: false } : false,
    })
    pool.on('error', (err) => {
      console.error('[DB] Unexpected pool error:', err)
    })
    console.log(`[DB] Pool created (ssl=${isProduction})`)
  }
  return pool
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end()
    pool = null
    console.log('[DB] Pool closed')
  }
}

export async function healthCheck(): Promise<boolean> {
  try {
    const result = await getPool().query('SELECT 1')
    return result.rowCount === 1
  } catch {
    return false
  }
}
