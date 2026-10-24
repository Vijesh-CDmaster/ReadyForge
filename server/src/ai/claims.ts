import { aiJson } from './client';
import { localAiEnabled, localVerify } from './local';
import { IKnowledgeInput } from '../models/KnowledgeInput';

export interface ClaimCheck {
  claim: string;
  status: 'verified' | 'unsupported' | 'partially_supported';
  evidence: string;
  sourceInputId?: string;
  saferRewrite?: string;
}

const CLAIM_MARKERS =
  /\b(best|first|#1|number one|guarantee[ds]?|always|never|proven|clinically|free|save\s?\d+%?|\d+%|\b\d+x\b|all users|everyone|unlimited|instantly)\b/gi;

export async function verifyClaims(opts: {
  content: string;
  approvedFacts: IKnowledgeInput[];
}): Promise<{ checks: ClaimCheck[]; source: 'ai' | 'rule_engine'; model: string }> {
  const { content, approvedFacts } = opts;

  const result = await aiJson<ClaimCheck[]>({
    system: `You are ReadyForge's Claim Verification Agent.
Given draft content and a list of approved facts:
1. Extract every factual or promotional claim.
2. Compare each claim with the approved facts.
3. Mark each claim verified | unsupported | partially_supported.
4. Provide evidence quoting the approved fact, or state that evidence is unavailable.
5. Suggest a safer rewrite using only approved information.
6. Never invent supporting facts.
Return a JSON array: { claim, status, evidence, sourceInputId (or null), saferRewrite }.`,
    user: JSON.stringify({
      content,
      approvedFacts: approvedFacts.map((f) => ({
        id: f._id.toString(),
        title: f.title,
        content: f.content,
        status: f.status,
      })),
    }),
    fallback: () => claimsFallback(content, approvedFacts),
  });

  const checks = (Array.isArray(result.data) ? result.data : [])
    .filter((c) => c && c.claim)
    .map((c) => ({
      ...c,
      status: (['verified', 'unsupported', 'partially_supported'].includes(c.status)
        ? c.status
        : 'unsupported') as ClaimCheck['status'],
    }));

  // Re-check each claim with our own trained NLI model (DistilBERT fine-tuned on MNLI):
  // entailment against an approved fact promotes the claim, contradiction demotes it.
  const usedLocal = await applyLocalVerification(checks, approvedFacts);
  const model = usedLocal
    ? result.source === 'ai'
      ? `${result.model} + readyforge-nli-distilbert`
      : 'readyforge-nli-distilbert'
    : result.model;
  return { checks, source: usedLocal ? 'ai' : result.source, model };
}

/**
 * Verifies claims against the best matching approved fact using the local model.
 * Fail-soft: returns false as soon as the service is unavailable.
 */
async function applyLocalVerification(checks: ClaimCheck[], facts: IKnowledgeInput[]): Promise<boolean> {
  if (!localAiEnabled() || !checks.length || !facts.length) return false;
  const approved = facts.filter((f) => f.status === 'approved');
  const pool = approved.length ? approved : facts;
  let used = false;

  for (const check of checks.slice(0, 20)) {
    let fact = check.sourceInputId ? pool.find((f) => f._id.toString() === check.sourceInputId) : undefined;
    if (!fact) fact = bestFactFor(check.claim, pool);
    if (!fact) continue;

    const verdict = await localVerify(check.claim, `${fact.title}. ${fact.content}`);
    if (!verdict) return used;
    used = true;

    if (verdict.verdict === 'supported') {
      check.status = 'verified';
      check.evidence = `Supported by approved fact: "${fact.title}" — ${fact.content}`;
      check.sourceInputId = fact._id.toString();
      delete check.saferRewrite;
    } else if (verdict.verdict === 'refuted') {
      check.status = 'unsupported';
      check.evidence = `The verification model contradicts the approved fact "${fact.title}" — ${fact.content}.`;
      check.sourceInputId = fact._id.toString();
      if (!check.saferRewrite) check.saferRewrite = rewriteUsing(check.claim, [fact]);
    }
    // not_enough_evidence: keep whatever the primary path decided
  }
  return used;
}

function bestFactFor(claim: string, facts: IKnowledgeInput[]): IKnowledgeInput | undefined {
  const claimTokens = tokenize(claim);
  let best: { score: number; fact?: IKnowledgeInput } = { score: 0 };
  for (const fact of facts) {
    const factTokens = tokenize(`${fact.title} ${fact.content}`);
    if (!factTokens.length) continue;
    const score = claimTokens.filter((t) => factTokens.includes(t)).length / factTokens.length;
    if (score > best.score) best = { score, fact };
  }
  return best.fact;
}

function claimsFallback(content: string, approvedFacts: IKnowledgeInput[]): ClaimCheck[] {
  const sentences = content
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const claims: ClaimCheck[] = [];
  for (const sentence of sentences) {
    const markers = sentence.match(CLAIM_MARKERS);
    const hasNumber = /\d+%|\b\d+x\b|₹\s?\d+|\$\s?\d+/.test(sentence);
    if (!markers && !hasNumber) continue;

    const sentenceTokens = tokenize(sentence);
    let best: { score: number; fact?: IKnowledgeInput } = { score: 0 };
    for (const fact of approvedFacts) {
      const factTokens = tokenize(`${fact.title} ${fact.content}`);
      const overlap = sentenceTokens.filter((t) => factTokens.includes(t)).length;
      const score = factTokens.length ? overlap / factTokens.length : 0;
      if (score > best.score) best = { score, fact };
    }

    if (best.score >= 0.6 && best.fact) {
      claims.push({
        claim: sentence,
        status: 'verified',
        evidence: `Supported by approved fact: "${best.fact.title}" — ${best.fact.content}`,
        sourceInputId: best.fact._id.toString(),
      });
    } else if (best.score >= 0.3 && best.fact) {
      claims.push({
        claim: sentence,
        status: 'partially_supported',
        evidence: `Partially supported by "${best.fact.title}" — ${best.fact.content}`,
        sourceInputId: best.fact._id.toString(),
        saferRewrite: rewriteUsing(sentence, approvedFacts),
      });
    } else {
      claims.push({
        claim: sentence,
        status: 'unsupported',
        evidence: 'No matching approved fact found in the Knowledge Ledger.',
        saferRewrite: rewriteUsing(sentence, approvedFacts),
      });
    }
  }
  return claims;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
}

function rewriteUsing(sentence: string, facts: IKnowledgeInput[]): string {
  const approved = facts.filter((f) => f.status === 'approved');
  if (!approved.length) return 'Remove this claim, or add and approve a supporting fact first.';
  const fact = approved[0];
  return `Safer rewrite using approved facts only: "${sentence.replace(CLAIM_MARKERS, '').trim()}" → "${fact.content}"`;
}
