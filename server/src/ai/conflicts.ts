import { aiJson } from './client';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { ConflictType } from '../models/Conflict';

export interface DetectedConflict {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  conflictType: ConflictType;
  relatedInputIds: string[];
  recommendedResolverRole: string;
  recommendedAction: string;
  impactIfUnresolved: string;
}

const RESOLVER_BY_TYPE: Record<ConflictType, string> = {
  factual: 'subject_matter_expert',
  pricing: 'finance_owner',
  audience: 'lead',
  tone: 'lead',
  rights: 'legal_reviewer',
  brand: 'designer',
  budget: 'finance_owner',
  goal: 'lead',
};

export async function detectConflicts(inputs: IKnowledgeInput[]): Promise<{
  conflicts: DetectedConflict[];
  source: 'ai' | 'rule_engine';
  model: string;
}> {
  const result = await aiJson<DetectedConflict[]>({
    system: `You are ReadyForge's Consensus Agent.
Analyse all knowledge inputs for a project.
Detect: direct contradictions, semantic contradictions, unsupported claims, missing dependencies,
rights risks, brand conflicts, budget conflicts.
For each issue return JSON array items: { title, description, severity (low|medium|high|critical),
conflictType (factual|pricing|audience|tone|rights|brand|budget|goal), relatedInputIds (array of input _ids),
recommendedResolverRole, recommendedAction, impactIfUnresolved }.
Do not invent facts. Only flag issues supported by the provided inputs. Return [] if none.`,
    user: JSON.stringify(
      inputs.map((i) => ({
        id: i._id.toString(),
        type: i.type,
        title: i.title,
        content: i.content,
        status: i.status,
        role: 'contributor',
        sourceType: i.sourceType,
      }))
    ),
    fallback: () => conflictsFallback(inputs),
  });

  const conflicts = (Array.isArray(result.data) ? result.data : [])
    .filter((c) => c && c.title && c.conflictType)
    .map((c) => ({
      ...c,
      severity: ['low', 'medium', 'high', 'critical'].includes(c.severity) ? c.severity : ('medium' as const),
      recommendedResolverRole: c.recommendedResolverRole || RESOLVER_BY_TYPE[c.conflictType] || 'lead',
      relatedInputIds: Array.isArray(c.relatedInputIds) ? c.relatedInputIds : [],
    }));
  return { conflicts, source: result.source, model: result.model };
}

/* ---------------- deterministic fallbacks ---------------- */

const NEGATIONS: Array<[RegExp, RegExp, string, ConflictType]> = [
  [/\b(everyone|all users|anyone|unlimited|free trial)\b/i, /\b(enterprise[- ]only|enterprise plans? only|paid only|no free)\b/i, 'Offer eligibility contradiction', 'pricing'],
  [/\bfree\b/i, /\b(paid|premium|subscription required)\b/i, 'Free vs paid contradiction', 'pricing'],
  [/\b(monthly)\b/i, /\b(annual|yearly)\b/i, 'Billing cadence contradiction', 'pricing'],
  [/\b(individuals?|consumers?|smb)\b/i, /\b(enterprise|developers?|schools?)\b/i, 'Audience definition contradiction', 'audience'],
  [/\b(playful|casual|humorous|funny)\b/i, /\b(professional|formal|serious|corporate)\b/i, 'Tone contradiction', 'tone'],
  [/\bguarantee[d]?\b/i, /\b(no guarantees?|results may vary|not guaranteed)\b/i, 'Guarantee contradiction', 'factual'],
];

function conflictsFallback(inputs: IKnowledgeInput[]): DetectedConflict[] {
  const found: DetectedConflict[] = [];
  const active = inputs.filter((i) => i.status !== 'rejected' && i.status !== 'expired');
  const key = (a: string, b: string) => [a, b].sort().join('|');
  const seen = new Set<string>();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (a.type === b.type && a.type === 'price') {
        const priceA = a.content.match(/[\d][\d,]*/);
        const priceB = b.content.match(/[\d][\d,]*/);
        if (priceA && priceB && priceA[0] !== priceB[0]) {
          push(found, seen, {
            title: 'Conflicting price points',
            description: `"${a.title}" states ${priceA[0]} while "${b.title}" states ${priceB[0]}.`,
            severity: 'critical',
            conflictType: 'pricing',
            relatedInputIds: [a._id.toString(), b._id.toString()],
            recommendedResolverRole: 'finance_owner',
            recommendedAction: 'Confirm the authoritative price and reject or update the other input.',
            impactIfUnresolved: 'Publishing an incorrect price is a customer-trust and compliance risk.',
          });
        }
        continue;
      }        const textA = `${a.title} ${a.content}`;
        const textB = `${b.title} ${b.content}`;
        for (const [reA, reB, label, type] of NEGATIONS) {
          const aPos = reA.test(textA);
          const aNeg = reB.test(textA);
          const bPos = reA.test(textB);
          const bNeg = reB.test(textB);
          // opposite poles: A states the positive side, B the negative side (or vice versa)
          if ((aPos && bNeg) || (aNeg && bPos)) {
          const k = key(a._id.toString(), b._id.toString());
          if (seen.has(k)) break;
          push(found, seen, {
            title: label,
            description: `"${a.title}" (${a.content}) contradicts "${b.title}" (${b.content}).`,
            severity: type === 'pricing' || type === 'factual' ? 'high' : 'medium',
            conflictType: type,
            relatedInputIds: [a._id.toString(), b._id.toString()],
            recommendedResolverRole: RESOLVER_BY_TYPE[type],
            recommendedAction: 'Decide the authoritative statement, then approve one input and reject the other.',
            impactIfUnresolved: 'Generated content would mix contradictory statements and fail verification.',
          });
          break;
        }
      }
    }
  }

  // Unsupported claims: claims not yet approved
  for (const input of inputs) {
    if (input.type === 'claim' && input.status !== 'approved') {
      push(found, seen, {
        title: `Unsupported claim: "${input.title}"`,
        description:
          'This claim is not backed by an approved fact in the Knowledge Ledger. Claims must be approved before generation.',
        severity: input.status === 'disputed' ? 'high' : 'medium',
        conflictType: 'factual',
        relatedInputIds: [input._id.toString()],
        recommendedResolverRole: 'subject_matter_expert',
        recommendedAction: 'Provide a source and approve the claim, or rewrite it using only approved facts.',
        impactIfUnresolved: 'Unsupported claims block generation and will fail output verification.',
      });
    }
  }

  return found;
}

function push(list: DetectedConflict[], seen: Set<string>, c: DetectedConflict): void {
  const k = [c.relatedInputIds].flat().sort().join('|');
  if (seen.has(k)) return;
  seen.add(k);
  list.push(c);
}
