-- doradobet-agent PostgreSQL tables
-- Run with: psql $DATABASE_URL -f scripts/create_tables.sql

-- Backend for the native memory tool
-- One row per user = their "memory file" managed by Claude via memory_20250818 tool
CREATE TABLE IF NOT EXISTS doradobet_memories (
  id         SERIAL PRIMARY KEY,
  user_id    TEXT NOT NULL UNIQUE,
  content    TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doradobet_memories_user_id ON doradobet_memories(user_id);

-- Audit log of all tool calls made by the agent (non-blocking writes)
CREATE TABLE IF NOT EXISTS doradobet_tool_audit (
  id          SERIAL PRIMARY KEY,
  user_id     TEXT,
  session_id  TEXT,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB,
  duration_ms INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doradobet_tool_audit_user_id   ON doradobet_tool_audit(user_id);
CREATE INDEX IF NOT EXISTS idx_doradobet_tool_audit_created_at ON doradobet_tool_audit(created_at DESC);

-- Optional: conversation audit for debugging
CREATE TABLE IF NOT EXISTS doradobet_conversations (
  id              SERIAL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  session_id      TEXT,
  correlation_id  TEXT UNIQUE,
  message_in      TEXT,
  message_out     TEXT,
  skill_used      TEXT,
  tool_calls_count INTEGER DEFAULT 0,
  duration_ms     INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_doradobet_conversations_user_id   ON doradobet_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_doradobet_conversations_created_at ON doradobet_conversations(created_at DESC);

-- Trigger to auto-update updated_at on doradobet_memories
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_doradobet_memories_updated_at ON doradobet_memories;
CREATE TRIGGER update_doradobet_memories_updated_at
  BEFORE UPDATE ON doradobet_memories
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
