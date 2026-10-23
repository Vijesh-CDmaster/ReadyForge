import { aiJson } from './client';
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
  return { checks, source: result.source, model: result.model };
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
