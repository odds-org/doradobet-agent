/**
 * Audit Logger — non-blocking tool call audit trail.
 * Records every tool invocation to PostgreSQL without blocking the agent loop.
 */

import { getPool } from '../infrastructure/db.js'

export interface AuditEntry {
  userId: string
  sessionId: string
  toolName: string
  toolInput: Record<string, unknown>
  durationMs?: number
}

export function auditToolCall(entry: AuditEntry): void {
  const pool = getPool()
  pool
    .query(
      `INSERT INTO doradobet_tool_audit (user_id, session_id, tool_name, tool_input, duration_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        entry.userId,
        entry.sessionId,
        entry.toolName,
        JSON.stringify(entry.toolInput),
        entry.durationMs ?? null,
      ]
    )
    .catch((err) => {
      // Non-blocking: log but don't throw
      console.warn('[AuditLogger] Failed to record tool call:', err)
    })
}
