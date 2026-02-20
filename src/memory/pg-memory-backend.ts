/**
 * PostgreSQL backend for the Anthropic native memory tool (memory_20250818).
 *
 * Claude treats /memories/user-{userId} as a "file" it can view, create,
 * and edit. We store the content in PostgreSQL instead of the filesystem,
 * giving production-grade persistence without any external dependency.
 *
 * Supported commands (same interface as Claude's memory tool):
 *   view       → SELECT content WHERE user_id
 *   create     → INSERT / UPSERT content
 *   str_replace → UPDATE content with string replacement
 *   find       → grep-like search within content
 *   delete     → DELETE row
 */

import { getPool } from '../infrastructure/db.js'

export class PgMemoryBackend {
  private formatWithLineNumbers(path: string, content: string): string {
    const lines = content.split('\n')
    const numbered = lines
      .map((line, i) => `${String(i + 1).padStart(6)}    ${line}`)
      .join('\n')
    return `Here's the content of ${path} with line numbers:\n${numbered}`
  }

  private extractUserId(path: string): string {
    // Accepts: /memories/user-{userId} or /memories/{userId}
    const match = path.match(/\/memories\/(?:user-)?(.+)/)
    if (!match) throw new Error(`Invalid memory path: "${path}". Expected: /memories/user-{userId}`)
    return match[1]
  }

  async view(path: string): Promise<string> {
    const pool = getPool()
    const userId = this.extractUserId(path)
    const result = await pool.query(
      'SELECT content FROM doradobet_memories WHERE user_id = $1',
      [userId]
    )
    if (!result.rowCount) {
      return `The path ${path} does not exist. To store information about this user, use the create command.`
    }
    return this.formatWithLineNumbers(path, result.rows[0].content as string)
  }

  async create(path: string, fileText: string): Promise<string> {
    const pool = getPool()
    const userId = this.extractUserId(path)
    await pool.query(
      `INSERT INTO doradobet_memories (user_id, content)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE
         SET content = $2, updated_at = NOW()`,
      [userId, fileText]
    )
    return `File created successfully at: ${path}`
  }

  async strReplace(path: string, oldStr: string, newStr: string): Promise<string> {
    const pool = getPool()
    const userId = this.extractUserId(path)
    const result = await pool.query(
      'SELECT content FROM doradobet_memories WHERE user_id = $1',
      [userId]
    )
    if (!result.rowCount) {
      return `The path ${path} does not exist. Use create to initialize it first.`
    }
    const content = result.rows[0].content as string
    if (!content.includes(oldStr)) {
      return `No replacement was performed — old_str did not appear verbatim in ${path}.\nMake sure the string matches exactly (including whitespace and line breaks).`
    }
    const newContent = content.replace(oldStr, newStr)
    await pool.query(
      'UPDATE doradobet_memories SET content = $1, updated_at = NOW() WHERE user_id = $2',
      [newContent, userId]
    )
    return `The memory file has been edited successfully.`
  }

  async find(path: string, pattern: string): Promise<string> {
    const pool = getPool()
    const userId = this.extractUserId(path)
    const result = await pool.query(
      'SELECT content FROM doradobet_memories WHERE user_id = $1',
      [userId]
    )
    if (!result.rowCount) {
      return `The path ${path} does not exist.`
    }
    const content = result.rows[0].content as string
    const matches = content
      .split('\n')
      .map((line, i) => ({ line, num: i + 1 }))
      .filter(({ line }) => line.toLowerCase().includes(pattern.toLowerCase()))
      .map(({ line, num }) => `${String(num).padStart(4)}: ${line}`)
    if (matches.length === 0) {
      return `No matches found for "${pattern}" in ${path}`
    }
    return `Matches for "${pattern}" in ${path}:\n${matches.join('\n')}`
  }

  async delete(path: string): Promise<string> {
    const pool = getPool()
    const userId = this.extractUserId(path)
    await pool.query('DELETE FROM doradobet_memories WHERE user_id = $1', [userId])
    return `File deleted successfully: ${path}`
  }

  /**
   * Main dispatcher — called from agent-runner for each memory tool_use block.
   */
  async handleToolCall(input: Record<string, unknown>): Promise<string> {
    const command = input.command as string
    const path = input.path as string

    try {
      switch (command) {
        case 'view':
          return await this.view(path)
        case 'create':
          return await this.create(path, input.file_text as string)
        case 'str_replace':
          return await this.strReplace(path, input.old_str as string, input.new_str as string)
        case 'find':
          return await this.find(path, input.pattern as string)
        case 'delete':
          return await this.delete(path)
        default:
          return `Unknown memory command: "${command}". Valid commands: view, create, str_replace, find, delete`
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[MemoryBackend] Error in ${command} on ${path}:`, message)
      return `Memory operation failed: ${message}`
    }
  }

  /**
   * Check if a user has a memory file (without triggering Claude's memory tool).
   * Used by skill-activator to determine which skill to load.
   */
  async exists(userId: string): Promise<boolean> {
    const pool = getPool()
    const result = await pool.query(
      'SELECT 1 FROM doradobet_memories WHERE user_id = $1',
      [userId]
    )
    return (result.rowCount ?? 0) > 0
  }
}

export const memoryBackend = new PgMemoryBackend()
