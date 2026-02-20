/**
 * Response Formatter — validates and guarantees MODULE 5 format before sending.
 *
 * MODULE 5 is the single wire format between doradobet-agent → io-server.
 * The io-server's ParseN8nResponse() already supports direct MODULE 5 JSON.
 *
 * Valid formats:
 *   Text:  { "type": "text", "data": { "message": "..." } }
 *   JSON:  { "type": "json", "data": { "message": "...", "liveEvents": [...] } }
 */

export interface Module5Text {
  type: 'text'
  data: { message: string }
}

export interface SportEvent {
  eventId: string
  name: string
  startDate: string
  sport: string
  league: string
  category: string
  url: string
  description?: string
}

export interface Module5Json {
  type: 'json'
  data: {
    message: string
    liveEvents?: SportEvent[]
    upcomingEvents?: SportEvent[]
    status?: string
  }
}

export type Module5Response = Module5Text | Module5Json

function cleanMarkdownCodeFences(input: string): string {
  // Remove ```json ... ``` wrappers that some LLMs add
  return input
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
}

function wrapAsText(message: string): Module5Text {
  return { type: 'text', data: { message: message.trim() } }
}

/**
 * Parses and validates the agent's raw output as MODULE 5.
 * Handles three cases:
 *   1. Pure MODULE 5 JSON  → parse and return directly
 *   2. Text with embedded JSON → extract the JSON block
 *   3. Plain text → wrap as type:text
 */
export function formatResponse(rawOutput: string): Module5Response {
  if (!rawOutput || !rawOutput.trim()) {
    return wrapAsText('No pude generar una respuesta. Por favor intenta de nuevo.')
  }

  const cleaned = cleanMarkdownCodeFences(rawOutput.trim())

  // 1. Try to parse the whole output as MODULE 5 JSON
  const direct = tryParseModule5(cleaned)
  if (direct) return direct

  // 2. Claude sometimes prepends plain text before the JSON.
  //    Extract the first valid MODULE 5 JSON block from the response.
  const extracted = extractModule5FromText(rawOutput)
  if (extracted) {
    console.log('[ResponseFormatter] Extracted MODULE 5 JSON from mixed text response')
    return extracted
  }

  // 3. Fallback: wrap everything as plain text
  // Strip raw JSON blobs before wrapping so the user doesn't see ugly JSON
  const stripped = rawOutput.replace(/\{[\s\S]*"type"\s*:\s*"(?:text|json)"[\s\S]*\}/g, '').trim()
  return wrapAsText(stripped || rawOutput.trim())
}

function tryParseModule5(text: string): Module5Response | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (
      (parsed.type === 'text' || parsed.type === 'json') &&
      parsed.data &&
      typeof parsed.data === 'object'
    ) {
      return parsed as unknown as Module5Response
    }
    return null
  } catch {
    return null
  }
}

function extractModule5FromText(text: string): Module5Response | null {
  // Find the first '{' that starts a MODULE 5 block
  const start = text.indexOf('{"type"')
  if (start === -1) return null

  // Try progressively shorter substrings from the found position
  const candidate = text.slice(start)
  // Find matching closing brace by counting depth
  let depth = 0
  let end = -1
  for (let i = 0; i < candidate.length; i++) {
    if (candidate[i] === '{') depth++
    else if (candidate[i] === '}') {
      depth--
      if (depth === 0) { end = i; break }
    }
  }
  if (end === -1) return null

  return tryParseModule5(candidate.slice(0, end + 1))
}

/**
 * Serializes MODULE 5 to the wire format expected by io-server.
 */
export function serializeResponse(response: Module5Response): string {
  return JSON.stringify(response)
}
