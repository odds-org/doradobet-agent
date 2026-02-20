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

/**
 * Run DB migrations at startup.
 * Uses IF NOT EXISTS — safe to run on every startup.
 */
export async function runMigrations(): Promise<void> {
  const db = getPool()
  console.log('[DB] Running migrations...')
  await db.query(`
    CREATE TABLE IF NOT EXISTS doradobet_memories (
      id         SERIAL PRIMARY KEY,
      user_id    TEXT NOT NULL UNIQUE,
      content    TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_doradobet_memories_user_id ON doradobet_memories(user_id);

    CREATE TABLE IF NOT EXISTS doradobet_tool_audit (
      id          SERIAL PRIMARY KEY,
      user_id     TEXT,
      session_id  TEXT,
      tool_name   TEXT NOT NULL,
      tool_input  JSONB,
      duration_ms INTEGER,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_doradobet_tool_audit_user_id    ON doradobet_tool_audit(user_id);
    CREATE INDEX IF NOT EXISTS idx_doradobet_tool_audit_created_at ON doradobet_tool_audit(created_at DESC);

    CREATE TABLE IF NOT EXISTS doradobet_conversations (
      id               SERIAL PRIMARY KEY,
      user_id          TEXT NOT NULL,
      session_id       TEXT,
      correlation_id   TEXT UNIQUE,
      message_in       TEXT,
      message_out      TEXT,
      skill_used       TEXT,
      tool_calls_count INTEGER DEFAULT 0,
      duration_ms      INTEGER,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_doradobet_conversations_user_id    ON doradobet_conversations(user_id);
    CREATE INDEX IF NOT EXISTS idx_doradobet_conversations_created_at ON doradobet_conversations(created_at DESC);

    CREATE OR REPLACE FUNCTION update_updated_at_column()
    RETURNS TRIGGER AS $$
    BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
    $$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS update_doradobet_memories_updated_at ON doradobet_memories;
    CREATE TRIGGER update_doradobet_memories_updated_at
      BEFORE UPDATE ON doradobet_memories
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  `)
  console.log('[DB] Migrations complete')
}
