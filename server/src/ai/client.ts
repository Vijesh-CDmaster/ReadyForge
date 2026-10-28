import { config, isAiConfigured } from '../config';

export interface AiResult<T> {
  data: T;
  source: 'ai' | 'rule_engine';
  model: string;
}

type ParseOutcome<T> = { ok: true; data: T } | { ok: false; error: string };

/**
 * Extract the first balanced JSON value (object or array) from surrounding prose,
 * respecting quoted strings and escaped characters so braces/brackets inside string
 * literals do not terminate the scan early.
 */
function extractBalanced(text: string): string | null {
  const start = text.search(/[{[]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{' || ch === '[') {
      depth += 1;
    } else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parse a model response into a JSON value. Order matters:
 *   1. the complete trimmed response (objects AND arrays — never re-slice valid JSON),
 *   2. a Markdown code fence's contents,
 *   3. a balanced {…} or […] found inside surrounding text.
 * Anything malformed reports `ok: false` with the underlying parse error.
 */
function tryParseJson<T>(raw: string): ParseOutcome<T> {
  const text = (raw ?? '').trim();
  if (!text) return { ok: false, error: 'empty response' };

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    // fall through to extraction
  }

  let lastError = 'no JSON value found in response';
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidates: string[] = [];
  if (fence) candidates.push(fence[1].trim());
  const balanced = extractBalanced(text);
  if (balanced) candidates.push(balanced);

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return { ok: true, data: JSON.parse(candidate) as T };
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  return { ok: false, error: lastError };
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint expecting a JSON response.
 * If no API key is configured (or the call fails), falls back to a deterministic
 * rule-engine function so the product always works. The `source` field is surfaced
 * to the UI so AI-assisted output can be labelled honestly: it is `'ai'` only when
 * the model's response was actually parsed and used, and `'rule_engine'` whenever
 * the fallback produced the data — including when a response failed to parse.
 */
export async function aiJson<T>(opts: {
  system: string;
  user: string;
  fallback: () => T;
  temperature?: number;
}): Promise<AiResult<T>> {
  const { system, user, fallback, temperature = 0.2 } = opts;
  // First line of the static system prompt names the operation (e.g.
  // "You are ReadyForge's Input Collection Agent.") — safe to log, never user content.
  const task = system.split('\n', 1)[0].trim().slice(0, 80);

  if (!isAiConfigured()) {
    return { data: fallback(), source: 'rule_engine', model: 'readyforge-rules' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    const res = await fetch(`${config.ai.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        temperature,
        messages: [
          { role: 'system', content: `${system}\nRespond with valid JSON only. No markdown, no prose.` },
          { role: 'user', content: user },
        ],
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`AI provider returned ${res.status}`);
    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content ?? '';

    const parsed = tryParseJson<T>(content);
    if (parsed.ok) {
      return { data: parsed.data, source: 'ai', model: config.ai.model };
    }
    console.warn(
      `[ai] response parse failed — using rule engine | task=${task} | error=${parsed.error} | contentLength=${content.length}`
    );
    return { data: fallback(), source: 'rule_engine', model: 'readyforge-rules' };
  } catch (err) {
    console.warn('[ai] call failed, using rule engine:', (err as Error).message);
    return { data: fallback(), source: 'rule_engine', model: 'readyforge-rules' };
  }
}

/** Back-compatible helper: parse or return the fallback. */
export function parseJson<T>(raw: string, fallback: () => T): T {
  const parsed = tryParseJson<T>(raw);
  return parsed.ok ? parsed.data : fallback();
}