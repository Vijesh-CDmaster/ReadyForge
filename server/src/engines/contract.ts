import { aiJson } from '../ai/client';
import { IProject } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IAsset } from '../models/Asset';
import { IConflict } from '../models/Conflict';
import { IProductionContract } from '../models/ProductionContract';

export interface ContractDraft {
  objective: string;
  audience: string;
  tone: string;
  keyMessage: string;
  callToAction: string;
  brandRules: string[];
  accessibilityRequirements: string[];
  localisationRequirements: string[];
  contentPlan: { outline: string[]; script: string };
  modelRoutingPlan: Array<{
    task: string;
    preferredModel: string;
    fallbackModel: string;
    estimatedCost: number;
    reason: string;
  }>;
  blockers: string[];
}

export async function buildContractDraft(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  assets: IAsset[];
  conflicts: IConflict[];
}): Promise<{ draft: ContractDraft; source: 'ai' | 'rule_engine'; model: string }> {
  const { project, inputs, assets, conflicts } = opts;

  const result = await aiJson<ContractDraft>({
    system: `You are ReadyForge's Contract Builder.
Create a Production Contract from validated project inputs using ONLY the provided data.
Return JSON with keys: objective, audience, tone, keyMessage, callToAction,
brandRules (string[]), accessibilityRequirements (string[]), localisationRequirements (string[]),
contentPlan: { outline: string[], script: string (2-4 sentence script direction, not a full script) },
modelRoutingPlan: [{ task, preferredModel, fallbackModel, estimatedCost, reason }],
blockers (string[]: missing required information, stated plainly).
Never invent facts, prices or claims not present in the inputs.`,
    user: JSON.stringify({
      project: {
        title: project.title,
        projectType: project.projectType,
        objective: project.objective,
        audience: project.audience,
        tone: project.tone,
        callToAction: project.callToAction,
        successMetric: project.successMetric,
        budget: project.budget,
        deadline: project.deadline,
      },
      inputs: inputs.map((i) => ({ type: i.type, title: i.title, content: i.content, status: i.status })),
      assets: assets.map((a) => ({ name: a.name, type: a.type, licenseStatus: a.licenseStatus })),
      openConflicts: conflicts
        .filter((c) => c.status === 'open' || c.status === 'awaiting_decision')
        .map((c) => ({ title: c.title, severity: c.severity, conflictType: c.conflictType })),
    }),
    fallback: () => contractFallback(project, inputs, assets, conflicts),
  });

  return { draft: sanitize(result.data, project), source: result.source, model: result.model };
}

function contractFallback(
  project: IProject,
  inputs: IKnowledgeInput[],
  assets: IAsset[],
  conflicts: IConflict[]
): ContractDraft {
  const byType = (type: string) => inputs.filter((i) => i.type === (type as never));
  const approved = (list: IKnowledgeInput[]) => list.filter((i) => i.status === 'approved');

  const facts = approved(byType('fact'));
  const claims = approved(byType('claim'));
  const goalInputs = byType('goal').filter((g) => g.status !== 'rejected' && g.status !== 'disputed');
  const goals = [...approved(goalInputs), ...goalInputs.filter((g) => g.status !== 'approved')];
  const toneRules = inputs.filter((i) => i.type === 'tone');
  const visualRules = approved(byType('visual_rule'));
  const legalRules = inputs.filter((i) => i.type === 'legal_rule');
  const constraints = inputs.filter((i) => i.type === 'constraint');

  const openConflicts = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');
  const riskyAssets = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );

  const blockers: string[] = [];
  if (!project.objective) blockers.push('Objective missing');
  if (!project.audience) blockers.push('Audience missing');
  if (!project.callToAction) blockers.push('Call to action missing');
  if (project.budget.amount <= 0) blockers.push('Budget not set');
  if (!facts.length) blockers.push('No approved facts in the Knowledge Ledger');
  openConflicts
    .filter((c) => c.severity === 'critical' || c.severity === 'high')
    .forEach((c) => blockers.push(`Unresolved ${c.severity} conflict: ${c.title}`));
  riskyAssets
    .filter((a) => a.licenseStatus !== 'unknown')
    .forEach((a) => blockers.push(`Asset "${a.name}" is ${a.licenseStatus} — cannot be used for final generation`));

  const keyMessage =
    goals[0]?.content || project.objective || 'Key message pending — add a goal input.';

  const outline = [
    'Hook: open on the audience problem in one line',
    `Value: state the key message — "${keyMessage}"`,
    `Proof: cite approved facts (${facts.length} available)`,
    `Call to action: ${project.callToAction || '[CTA required]'}`,
  ];

  const script =
    `Scene direction for "${project.title}": open with the audience pain point, transition to the key message, ` +
    `back it with approved facts only (${facts.map((f) => f.title).join('; ') || 'none approved yet'}), ` +
    `close with the CTA (${project.callToAction || 'TBD'}) in a ${project.tone || 'neutral'} tone.`;

  const modelRoutingPlan = [
    { task: 'outline', preferredModel: 'gpt-4o-mini', fallbackModel: 'llama-3.1-8b', estimatedCost: 5, reason: 'Cheap summarisation-class task' },
    { task: 'script', preferredModel: 'gpt-4o', fallbackModel: 'qwen-2.5-72b', estimatedCost: 40, reason: 'High-quality writing task' },
    { task: 'storyboard', preferredModel: 'gpt-4o', fallbackModel: 'llama-3.1-70b', estimatedCost: 60, reason: 'Structured scene planning' },
    { task: 'image', preferredModel: 'sdxl-turbo', fallbackModel: 'sdxl', estimatedCost: 30, reason: 'Open-source image generation' },
    { task: 'voiceover', preferredModel: 'piper-tts', fallbackModel: 'coqui-tts', estimatedCost: 15, reason: 'Free local speech synthesis' },
    { task: 'verification', preferredModel: 'gpt-4o-mini', fallbackModel: 'readyforge-rules', estimatedCost: 10, reason: 'Deterministic checks plus model-assisted review' },
  ];

  return {
    objective: project.objective || '',
    audience: project.audience || '',
    tone: project.tone || toneRules[0]?.content || '',
    keyMessage,
    callToAction: project.callToAction || '',
    brandRules: visualRules.map((v) => `${v.title}: ${v.content}`),
    accessibilityRequirements: constraints
      .filter((c) => /accessib|caption|alt|contrast|wcag/i.test(`${c.title} ${c.content}`))
      .map((c) => `${c.title}: ${c.content}`),
    localisationRequirements: constraints
      .filter((c) => /localis|localiz|language|region/i.test(`${c.title} ${c.content}`))
      .map((c) => `${c.title}: ${c.content}`),
    contentPlan: { outline, script },
    modelRoutingPlan,
    blockers,
  };
}

/**
 * Coerce an AI-returned value to a string. Small models occasionally return an
 * object (e.g. {type:"webinar", url:...}) where a string is expected; without
 * this, mongoose cast validation failed and contract creation returned a 500.
 */
function asString(v: unknown, fallback = ''): string {
  if (typeof v === 'string') return v;
  if (v == null) return fallback;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const pick = [o.text, o.value, o.label, o.title].find((x) => typeof x === 'string');
    if (pick) return pick as string;
    if (typeof o.url === 'string') return o.type ? `${String(o.type)}: ${o.url}` : o.url;
    try {
      return JSON.stringify(v);
    } catch {
      return fallback;
    }
  }
  return String(v);
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => asString(x)).filter(Boolean);
}

function sanitize(draft: ContractDraft, project: IProject): ContractDraft {
  const d = draft && typeof draft === 'object' ? draft : ({} as ContractDraft);
  return {
    objective: asString(d.objective) || project.objective || '',
    audience: asString(d.audience) || project.audience || '',
    tone: asString(d.tone) || project.tone || '',
    keyMessage: asString(d.keyMessage),
    callToAction: asString(d.callToAction) || project.callToAction || '',
    brandRules: asStringArray(d.brandRules),
    accessibilityRequirements: asStringArray(d.accessibilityRequirements),
    localisationRequirements: asStringArray(d.localisationRequirements),
    contentPlan: {
      outline: asStringArray(d.contentPlan?.outline),
      script: asString(d.contentPlan?.script),
    },
    modelRoutingPlan: Array.isArray(d.modelRoutingPlan)
      ? d.modelRoutingPlan.map((r) => ({
          task: asString(r?.task),
          preferredModel: asString(r?.preferredModel),
          fallbackModel: asString(r?.fallbackModel),
          estimatedCost: Number(r?.estimatedCost) || 0,
          reason: asString(r?.reason),
        }))
      : [],
    blockers: asStringArray(d.blockers),
  };
}

export function requiredApproversFor(project: IProject, members: Array<{ userId: unknown; role: string }>): Array<{ userId: unknown; role: string }> {
  const wanted = new Set<string>(['lead', 'reviewer']);
  if (project.budget.amount > 0) wanted.add('finance_owner');
  const chosen: Array<{ userId: unknown; role: string }> = [];
  for (const role of wanted) {
    const member = members.find((m) => m.role === role);
    if (member) chosen.push({ userId: member.userId, role });
  }
  if (!chosen.length && members.length) {
    chosen.push({ userId: members[0].userId, role: members[0].role });
  }
  return chosen;
}
