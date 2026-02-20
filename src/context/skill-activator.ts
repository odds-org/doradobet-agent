/**
 * Skill Activator — selects which skill(s) to load based on user context.
 *
 * Skills are layered instructions loaded into the system prompt.
 * Only one skill is active at a time for clarity.
 *
 * Decision tree:
 *   1. No memory file → onboarding (collect name + preferences)
 *   2. First message of day + no text → proactivo (morning briefing)
 *   3. Everything else → reactivo (respond to user query)
 */

export type SkillName = 'onboarding' | 'proactivo' | 'reactivo'

export interface SkillDecision {
  skills: SkillName[]
  reason: string
}

export function activateSkills(ctx: {
  hasMemoryFile: boolean
  isFirstMessageOfDay: boolean
  message: string
}): SkillDecision {
  // Case 1: No memory file → only onboarding
  if (!ctx.hasMemoryFile) {
    return {
      skills: ['onboarding'],
      reason: 'Usuario sin perfil guardado — recolectar nombre y preferencias deportivas',
    }
  }

  // Case 2: First message of the day with no text → proactive morning briefing
  if (ctx.isFirstMessageOfDay && !ctx.message.trim()) {
    return {
      skills: ['proactivo'],
      reason: 'Primer mensaje del día sin texto — enviar briefing deportivo matutino',
    }
  }

  // Case 3: Default — respond to user's message
  return {
    skills: ['reactivo'],
    reason: 'Usuario con perfil + mensaje — responder con tools según intención',
  }
}
