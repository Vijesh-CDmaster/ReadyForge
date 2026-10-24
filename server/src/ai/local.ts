import { config } from '../config';

/**
 * Client for ReadyForge's local model service (../ai-service, FastAPI on port 8001).
 *
 * These endpoints are backed by a DistilBERT model we fine-tuned ourselves on the
 * MNLI dataset — no external API keys. Every call fails soft: when the service is
 * not running (or LOCAL_AI_URL is unset) the caller falls through to its existing
 * LLM/rule-engine path, so the product never depends on the Python sidecar.
 */

export interface LocalConflictResult {
  id?: string;
  label: 'entailment' | 'neutral' | 'contradiction';
  is_conflict: boolean;
  scores: Record<string, number>;
  model: string;
}

export interface LocalVerifyResult {
  verdict: 'supported' | 'refuted' | 'not_enough_evidence';
  scores: Record<string, number>;
  model: string;
}

export interface LocalClassifyResult {
  prediction: string;
  ranked: Array<{ label: string; score: number }>;
  model: string;
}

export const localAiEnabled = () => Boolean(config.localAiUrl);

async function postLocal<T>(path: string, body: unknown, timeoutMs = 20_000): Promise<T | null> {
  const base = config.localAiUrl;
  if (!base) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      console.warn(`[ai] local model ${path} returned ${res.status}`);
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[ai] local model unavailable (${path}):`, (err as Error).message);
    return null;
  }
}

/** Single premise/hypothesis contradiction score. */
export const localConflict = (inputA: string, inputB: string) =>
  postLocal<LocalConflictResult>('/nli/conflict', { inputA, inputB });

/** Batched contradiction scoring — one forward pass for many input pairs. */
export const localConflictBatch = (pairs: Array<{ id: string; a: string; b: string }>) =>
  postLocal<{ results: LocalConflictResult[] }>('/nli/conflict_batch', { pairs }, 45_000);

/** Claim-vs-evidence verification (entailment). */
export const localVerify = (claim: string, evidence: string) =>
  postLocal<LocalVerifyResult>('/nli/verify', { claim, evidence }, 15_000);

/** Zero-shot classification over a label set. */
export const localClassify = (text: string, labels: readonly string[], hypothesisTemplate?: string) =>
  postLocal<LocalClassifyResult>('/nli/classify', { text, labels, hypothesis_template: hypothesisTemplate }, 15_000);