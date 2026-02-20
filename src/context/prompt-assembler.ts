/**
 * Prompt Assembler — builds the system prompt by stacking layers:
 *
 *   1. paul.md              — Agent identity, personality, MODULE 5 overview
 *   2. way_output_format.md — GOLDEN RULE: always output valid MODULE 5 JSON
 *   3. way_memory.md        — When and how to use the memory tool
 *   4. way_tools.md         — When to use Altenar vs web_search
 *   5. skill_*.md           — Active skill instructions (only the selected one)
 *   6. Runtime context      — Date, userId, memory path, conversation history
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { UserContext } from './builder.js'
import type { SkillName } from './skill-activator.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROMPTS_DIR = join(__dirname, '..', '..', 'prompts')

// Hot-cache prompt files — cleared on process restart
const fileCache = new Map<string, string>()

function loadFile(relativePath: string): string {
  const cached = fileCache.get(relativePath)
  if (cached !== undefined) return cached

  try {
    const content = readFileSync(join(PROMPTS_DIR, relativePath), 'utf-8')
    fileCache.set(relativePath, content)
    return content
  } catch {
    console.warn(`[PromptAssembler] Missing prompt file: ${relativePath}`)
    fileCache.set(relativePath, '') // Cache empty to avoid repeated FS errors
    return ''
  }
}

export function assemblePrompt(ctx: UserContext, skills: SkillName[]): string {
  const parts: string[] = []

  // 1. Agent identity
  parts.push(loadFile('paul.md'))

  // 2. Output format — ALWAYS required, non-negotiable
  const outputFormat = loadFile('ways/way_output_format.md')
  if (outputFormat) parts.push('\n\n---\n\n' + outputFormat)

  // 3. Memory tool usage rules
  const memoryWay = loadFile('ways/way_memory.md')
  if (memoryWay) parts.push('\n\n---\n\n' + memoryWay)

  // 4. Tool selection rules
  const toolsWay = loadFile('ways/way_tools.md')
  if (toolsWay) parts.push('\n\n---\n\n' + toolsWay)

  // 5. Active skills
  for (const skill of skills) {
    const content = loadFile(`skills/skill_${skill}.md`)
    if (content) {
      parts.push(`\n\n---\n\n## SKILL ACTIVO: ${skill.toUpperCase()}\n\n${content}`)
    }
  }

  // 6. Runtime context
  parts.push(`\n\n---\n\n## CONTEXTO DE SESIÓN

- **Fecha y hora (Bogotá)**: ${ctx.bogotaDate}, ${ctx.bogotaTime}
- **userId**: \`${ctx.userId}\`
- **sessionId**: \`${ctx.sessionId}\`
- **Memory path del usuario**: \`/memories/user-${ctx.userId}\`
- **Tiene perfil guardado**: ${ctx.hasMemoryFile ? 'Sí' : 'No — usar skill_onboarding'}
- **Primer mensaje del día**: ${ctx.isFirstMessageOfDay ? 'Sí' : 'No'}`)

  // 7. Conversation history (last 10 turns)
  if (ctx.context && ctx.context.length > 0) {
    const history = ctx.context
      .slice(-10)
      .map((t) => `**${t.role === 'user' ? 'Usuario' : 'Paul'}**: ${t.content}`)
      .join('\n\n')
    parts.push(`\n\n---\n\n## HISTORIAL DE CONVERSACIÓN\n\n${history}`)
  }

  return parts.join('')
}

/**
 * Force reload of all prompt files (useful in development).
 */
export function clearPromptCache(): void {
  fileCache.clear()
  console.log('[PromptAssembler] Cache cleared')
}
