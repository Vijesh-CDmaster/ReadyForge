import { config, isAiConfigured } from '../config';

export interface AiResult<T> {
  data: T;
  source: 'ai' | 'rule_engine';
  model: string;
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint expecting a JSON response.
 * If no API key is configured (or the call fails), falls back to a deterministic
 * rule-engine function so the product always works. The `source` field is surfaced
 * to the UI so AI-assisted output can be labelled honestly.
 */
export async function aiJson<T>(opts: {
  system: string;
  user: string;
  fallback: () => T;
  temperature?: number;
}): Promise<AiResult<T>> {
  const { system, user, fallback, temperature = 0.2 } = opts;

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
    return { data: parseJson(content, fallback), source: 'ai', model: config.ai.model };
  } catch (err) {
    console.warn('[ai] call failed, using rule engine:', (err as Error).message);
    return { data: fallback(), source: 'rule_engine', model: 'readyforge-rules' };
  }
}

export function parseJson<T>(raw: string, fallback: () => T): T {
  try {
    let text = raw.trim();
    const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) text = fence[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    return JSON.parse(text) as T;
  } catch {
    return fallback();
  }
}
