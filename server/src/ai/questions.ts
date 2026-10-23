import { aiJson } from './client';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IProject } from '../models/Project';

export interface AdaptiveQuestion {
  key: string;
  text: string;
  inputType: 'text' | 'textarea' | 'number' | 'choice' | 'date' | 'multiselect';
  inputKind: string; // maps to knowledgeInputs.type
  why: string;
  role: string;
  required: boolean;
}

interface BankItem extends AdaptiveQuestion {
  appliesTo?: string[]; // project types; undefined = all
  whenAbsent?: boolean; // only ask if no input with this inputKind exists
}

const BANK: BankItem[] = [
  {
    key: 'audience',
    text: 'Who is the exact audience for this content?',
    inputType: 'text',
    inputKind: 'audience',
    why: 'Every downstream check (tone, claims, channel) depends on a defined audience.',
    role: 'lead',
    required: true,
    whenAbsent: true,
  },
  {
    key: 'objective',
    text: 'What single outcome should this content achieve?',
    inputType: 'textarea',
    inputKind: 'goal',
    why: 'Intent alignment is verified against this objective during output verification.',
    role: 'lead',
    required: true,
    whenAbsent: true,
  },
  {
    key: 'call_to_action',
    text: 'What action should the viewer/reader take?',
    inputType: 'text',
    inputKind: 'goal',
    why: 'Without a CTA, intent alignment cannot be scored and the script has no ending.',
    role: 'writer',
    required: true,
    whenAbsent: false,
  },
  {
    key: 'tone',
    text: 'What tone should the content strike?',
    inputType: 'choice',
    inputKind: 'tone',
    why: 'Tone conflicts are one of the most common causes of regeneration.',
    role: 'writer',
    required: true,
    whenAbsent: true,
  },
  {
    key: 'product_facts',
    text: 'List the product/service facts that must appear (name, price, results).',
    inputType: 'textarea',
    inputKind: 'fact',
    why: 'Claims without an approved fact are blocked at verification.',
    role: 'subject_matter_expert',
    required: true,
    whenAbsent: true,
  },
  {
    key: 'brand_assets',
    text: 'Are there brand assets or references (logo, colours, fonts)?',
    inputType: 'text',
    inputKind: 'asset_requirement',
    why: 'Brand fit scoring needs the rules; unlicensed assets block final render.',
    role: 'designer',
    required: false,
    whenAbsent: true,
  },
  {
    key: 'music_rights',
    text: 'Will music or third-party media be used, and is it licensed?',
    inputType: 'choice',
    inputKind: 'legal_rule',
    why: 'Rights clearance is a hard blocker for final generation.',
    role: 'legal_reviewer',
    required: false,
    whenAbsent: true,
    appliesTo: ['video', 'ad', 'social_post'],
  },
  {
    key: 'budget',
    text: 'What is the budget for generation (amount and currency)?',
    inputType: 'number',
    inputKind: 'constraint',
    why: 'Cost-at-risk and budget feasibility cannot be computed without it.',
    role: 'finance_owner',
    required: true,
    whenAbsent: false,
  },
  {
    key: 'deadline',
    text: 'What is the deadline?',
    inputType: 'date',
    inputKind: 'constraint',
    why: 'Feeds planning and the bottleneck section of analytics.',
    role: 'lead',
    required: false,
    whenAbsent: false,
  },
  {
    key: 'accessibility',
    text: 'Any accessibility requirements (captions, contrast, alt text)?',
    inputType: 'multiselect',
    inputKind: 'constraint',
    why: 'Accessibility carries a readiness weight and is checked at verification.',
    role: 'reviewer',
    required: false,
    whenAbsent: true,
  },
];

export async function generateQuestions(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  classificationRequired?: string[];
  count?: number;
}): Promise<{ questions: AdaptiveQuestion[]; source: 'ai' | 'rule_engine'; model: string }> {
  const { project, inputs, count = 4 } = opts;

  const result = await aiJson<AdaptiveQuestion[]>({
    system: `You are ReadyForge's Input Collection Agent.
Based on the project type, goal and already collected inputs, generate the next 3-5 most important questions.
Rules: ask only relevant questions; never repeat answered questions; prioritise missing critical information;
assign each question to the correct role (owner|lead|writer|designer|subject_matter_expert|reviewer|legal_reviewer|finance_owner|viewer);
mark required vs optional; explain briefly why it matters.
Return a JSON array of objects: { key, text, inputType, inputKind, why, role, required }.
inputType is one of text|textarea|number|choice|date|multiselect.
inputKind is one of fact|claim|constraint|audience|tone|price|asset_requirement|goal|visual_rule|legal_rule|other.`,
    user: JSON.stringify({
      project: {
        title: project.title,
        description: project.description,
        projectType: project.projectType,
        mode: project.mode,
        objective: project.objective,
        audience: project.audience,
        tone: project.tone,
        callToAction: project.callToAction,
        budget: project.budget,
      },
      existingInputs: inputs.map((i) => ({ kind: i.type, title: i.title, content: i.content })),
    }),
    fallback: () => questionsFallback(project, inputs, count),
  });

  const cleaned = (Array.isArray(result.data) ? result.data : [])
    .filter((q) => q && q.text && q.key)
    .slice(0, count + 2);
  return { questions: cleaned.slice(0, count), source: result.source, model: result.model };
}

function questionsFallback(project: IProject, inputs: IKnowledgeInput[], count: number): AdaptiveQuestion[] {
  const answeredKinds = new Set(inputs.map((i) => i.type));
  const answeredText = inputs.map((i) => `${i.title} ${i.content}`.toLowerCase());

  const answeredKeys: string[] = [];
  if (project.objective) answeredKeys.push('objective');
  if (project.audience) answeredKeys.push('audience');
  if (project.tone) answeredKeys.push('tone');
  if (project.callToAction) answeredKeys.push('call_to_action');
  if (project.budget.amount > 0) answeredKeys.push('budget');
  if (project.deadline) answeredKeys.push('deadline');

  const picked: AdaptiveQuestion[] = [];
  for (const item of BANK) {
    if (picked.length >= count) break;
    if (item.appliesTo && !item.appliesTo.includes(project.projectType)) continue;
    if (answeredKeys.includes(item.key)) continue;
    if (item.whenAbsent && answeredKinds.has(item.inputKind as never)) continue;
    const dup = answeredText.some((t) => t.includes(item.text.slice(0, 30).toLowerCase()));
    if (dup) continue;
    const { appliesTo: _a, whenAbsent: _w, ...q } = item;
    picked.push(q);
  }
  return picked;
}
