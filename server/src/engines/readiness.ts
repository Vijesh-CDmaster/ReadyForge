import { IProject, LadderStage } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IAsset } from '../models/Asset';
import { IProductionContract } from '../models/ProductionContract';
import { computePlannedStageCost } from './stageCost';

export interface ReadinessCategory {
  key: string;
  label: string;
  weight: number; // percentage
  score: number; // 0..weight
  reason: string;
}

export type EvidenceStatus = 'verified' | 'failed' | 'missing' | 'unknown' | 'not_applicable';
export type AssessmentMethod = 'deterministic' | 'ai_assisted' | 'human_required';
export type RubricCategory = 'food' | 'tutorial' | 'advertisement' | 'documentary' | 'social_creator';

export interface ReadinessEvidence {
  key: string;
  label: string;
  status: EvidenceStatus;
  reason: string;
  method?: AssessmentMethod;
  evidenceRef?: string;
  mandatoryBlocker?: boolean;
  scoreImpact?: number;
  category?: RubricCategory;
}

export interface Issue {
  severity: 'blocker' | 'warning';
  code: string;
  message: string;
  entityIds?: string[];
}

export interface ReadinessReport {
  score: number; // 0..100
  categories: ReadinessCategory[];
  blockingIssues: Issue[];
  warnings: Issue[];
  recommendations: string[];
  missingRequirements: string[];
  approvalGate: { required: number; approved: number; satisfied: boolean };
  evidence: ReadinessEvidence[];
  categoryAssessment: {
    category: RubricCategory | null;
    criteria: ReadinessEvidence[];
    limitation?: string;
  };
  productionAuthorization: { authorized: boolean; blockers: Issue[] };
  generatedAt: Date;
  source: 'ai' | 'rule_engine';
}

export const REQUIRED_FIELDS: Array<{ field: keyof IProject; label: string }> = [
  { field: 'objective', label: 'Objective' },
  { field: 'audience', label: 'Audience' },
  { field: 'tone', label: 'Tone' },
  { field: 'callToAction', label: 'Call to action' },
  { field: 'deadline', label: 'Deadline' },
];

export function computeReadiness(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  assets: IAsset[];
  contract?: IProductionContract | null;
  requiredStage?: LadderStage;
}): ReadinessReport {
  const { project, inputs, conflicts, assets, contract, requiredStage = project.currentStage } = opts;

  const blockingIssues: Issue[] = [];
  const warnings: Issue[] = [];
  const recommendations: string[] = [];
  const missing: string[] = [];
  const evidence: ReadinessEvidence[] = [];

  /* ---- Completeness (25%) ---- */
  const missingFields = REQUIRED_FIELDS.filter((f) => !project[f.field]).map((f) => f.label);
  const hasBudget = project.budget.amount > 0;
  if (!hasBudget) missingFields.push('Budget');
  missing.push(...missingFields.map((m) => `Project field missing: ${m}`));

  const approvedInputs = inputs.filter((i) => i.status === 'approved');
  const requiredKinds = ['audience', 'goal', 'fact'];
  const missingKinds = requiredKinds.filter((k) => !inputs.some((i) => i.type === (k as never)));
  missingKinds.forEach((k) => missing.push(`No knowledge input of type "${k}" yet`));

  const requiresScript = ['script', 'storyboard', 'preview', 'final'].includes(requiredStage);
  const requiresStoryboard = ['storyboard', 'preview', 'final'].includes(requiredStage);
  const scriptPresent = Boolean(contract?.contentPlan.script.trim());
  const storyboardPresent = Boolean(contract?.contentPlan.storyboard.length);
  const productionEvidence = [
    {
      key: 'script',
      label: 'Production script',
      required: requiresScript,
      present: scriptPresent,
      reason: scriptPresent ? `Script is present in Production Contract v${contract?.version ?? 'unknown'}.` : 'No script is present in the current Production Contract.',
    },
    {
      key: 'storyboard',
      label: 'Storyboard',
      required: requiresStoryboard,
      present: storyboardPresent,
      reason: storyboardPresent ? `${contract?.contentPlan.storyboard.length} storyboard scene(s) are present.` : 'No storyboard scenes are present in the current Production Contract.',
    },
  ];
  productionEvidence.forEach((item) => {
    const status: EvidenceStatus = !item.required ? 'not_applicable' : item.present ? 'verified' : 'missing';
    evidence.push({ key: item.key, label: item.label, status, reason: item.reason });
    if (status === 'missing') missing.push(`Required production evidence missing: ${item.label} for ${requiredStage} stage`);
  });

  const applicableEvidence = productionEvidence.filter((item) => item.required);
  const completenessRatio =
    (REQUIRED_FIELDS.filter((f) => Boolean(project[f.field])).length + (hasBudget ? 1 : 0) +
      applicableEvidence.filter((item) => item.present).length) /
    (REQUIRED_FIELDS.length + 1 + applicableEvidence.length);
  const completenessScore = 25 * completenessRatio;
  if (missingFields.length) {
    warnings.push({ severity: 'warning', code: 'missing_fields', message: `Missing required fields: ${missingFields.join(', ')}` });
    recommendations.push('Complete the missing project fields in Project Overview.');
  }
  const missingProductionEvidence = productionEvidence.filter((item) => item.required && !item.present);
  if (missingProductionEvidence.length) {
    warnings.push({
      severity: 'warning',
      code: 'missing_production_evidence',
      message: missingProductionEvidence.map((item) => `${item.label} is missing for the ${requiredStage} stage`).join('; '),
    });
    recommendations.push('Complete the required script and storyboard evidence before treating this stage as production-ready.');
  }

  /* ---- Consistency (20%) ---- */
  const openConflicts = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');
  const criticalOpen = openConflicts.filter((c) => c.severity === 'critical');
  const highOpen = openConflicts.filter((c) => c.severity === 'high');
  const consistencyScore =
    openConflicts.length === 0 ? 20 : Math.max(0, 20 - openConflicts.length * 5 - criticalOpen.length * 3);
  if (criticalOpen.length) {
    blockingIssues.push({
      severity: 'blocker',
      code: 'critical_conflict',
      message: `${criticalOpen.length} critical conflict(s) unresolved: ${criticalOpen.map((c) => c.title).join('; ')}`,
      entityIds: criticalOpen.map((c) => c._id.toString()),
    });
    recommendations.push('Resolve critical conflicts in the Conflict Room before validation can pass.');
  } else if (highOpen.length) {
    blockingIssues.push({
      severity: 'blocker',
      code: 'high_conflict',
      message: `${highOpen.length} high-severity conflict(s) unresolved`,
      entityIds: highOpen.map((c) => c._id.toString()),
    });
    recommendations.push('Resolve the open high-severity conflicts to unblock generation.');
  } else if (openConflicts.length) {
    warnings.push({ severity: 'warning', code: 'open_conflicts', message: `${openConflicts.length} lower-severity conflict(s) open` });
    recommendations.push('Resolve remaining conflicts to raise consistency.');
  }

  /* ---- Factual support (20%) ---- */
  const claims = inputs.filter((i) => i.type === 'claim');
  const approvedClaims = claims.filter((i) => i.status === 'approved');
  const unsupportedClaims = claims.filter((i) => i.status !== 'approved' && i.status !== 'rejected');
  const facts = inputs.filter((i) => i.type === 'fact' && i.status === 'approved');
  let factualScore: number;
  if (claims.length === 0) {
    factualScore = facts.length ? 14 : 6;
    if (!facts.length) {
      warnings.push({ severity: 'warning', code: 'no_facts', message: 'No approved facts in the ledger — generation would rely on unverified content.' });
      recommendations.push('Add and approve at least one factual input from the subject-matter expert.');
    }
  } else {
    factualScore = 20 * (approvedClaims.length / claims.length);
    if (unsupportedClaims.length) {
      const severity = unsupportedClaims.length >= 2 ? 'blocker' : 'warning';
      const issue: Issue = {
        severity: severity as 'blocker' | 'warning',
        code: 'unsupported_claim',
        message: `${unsupportedClaims.length} claim(s) not backed by approved facts: ${unsupportedClaims.map((c) => c.title).join('; ')}`,
        entityIds: unsupportedClaims.map((c) => idOf(c) ?? c.title),
      };
      (severity === 'blocker' ? blockingIssues : warnings).push(issue);
      recommendations.push('Approve each claim with a source, or rewrite it using approved facts only.');
    }
  }

  /* ---- Rights clearance (15%) ---- */
  const riskyAssets = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );
  const consentPending = assets.filter((a) => a.consentRequired && a.consentStatus !== 'approved');
  const rightsScore =
    assets.length === 0
      ? 9
      : 15 * Math.max(0, (assets.length - riskyAssets.length - consentPending.length) / assets.length);
  if (riskyAssets.length) {
    const restricted = riskyAssets.filter((a) => a.licenseStatus === 'restricted' || a.licenseStatus === 'expired');
    if (restricted.length) {
      blockingIssues.push({
        severity: 'blocker',
        code: 'unlicensed_asset',
        message: `${restricted.length} asset(s) cannot be used for final generation: ${restricted.map((a) => a.name).join(', ')}`,
        entityIds: restricted.map((a) => a._id.toString()),
      });
      recommendations.push('Replace or licence restricted/expired assets in the Rights & Licence Manager.');
    } else {
      warnings.push({
        severity: 'warning',
        code: 'unknown_license',
        message: `${riskyAssets.length} asset(s) with unknown licence status: ${riskyAssets.map((a) => a.name).join(', ')}`,
      });
      recommendations.push('Set a licence status (owned/licenced) with evidence for each asset.');
    }
  }
  if (consentPending.length) {
    warnings.push({ severity: 'warning', code: 'consent_pending', message: `${consentPending.length} asset(s) pending consent` });
  }
  if (!assets.length) {
    warnings.push({ severity: 'warning', code: 'no_assets', message: 'No assets uploaded yet — brand fit will rely on text rules only.' });
  }

  /* ---- Brand fit (10%) ---- */
  const brandRules = inputs.filter(
    (i) => (i.type === 'visual_rule' || i.type === 'constraint') && i.status === 'approved'
  );
  const brandScore = brandRules.length >= 2 ? 10 : brandRules.length === 1 ? 6 : 2;
  if (brandRules.length < 2) {
    warnings.push({ severity: 'warning', code: 'weak_brand_rules', message: 'Fewer than 2 approved brand/visual rules.' });
    recommendations.push('Add approved visual rules (colours, fonts, logo usage) for better brand-fit verification.');
  }

  /* ---- Accessibility (5%) ---- */
  const a11yInputs = inputs.filter(
    (i) => /accessib|caption|alt text|contrast|wcag|subtitle/i.test(`${i.title} ${i.content} ${i.tags.join(' ')}`)
  );
  const a11yScore = a11yInputs.length ? 5 : 1;
  if (!a11yInputs.length) {
    warnings.push({ severity: 'warning', code: 'no_accessibility', message: 'No accessibility requirements recorded.' });
    recommendations.push('Record accessibility requirements (captions, contrast, alt text).');
  }

  /* ---- Budget feasibility (5%) ---- */
  const plannedCost = computePlannedStageCost(requiredStage);
  const budgetFeasible = hasBudget && project.budget.remaining >= plannedCost;
  const budgetScore = !hasBudget ? 0 : budgetFeasible ? 5 : 2;
  if (!hasBudget) {
    blockingIssues.push({ severity: 'blocker', code: 'no_budget', message: 'No budget set — cost-at-risk and budget checks cannot run.' });
    recommendations.push('Set a generation budget on the project.');
  } else if (!budgetFeasible) {
    warnings.push({
      severity: 'warning',
      code: 'budget_tight',
      message: `Planned cost ${plannedCost} exceeds remaining budget ${project.budget.remaining} — finance approval required.`,
    });
    recommendations.push('Increase the budget or request finance-owner approval before generating.');
  }

  const categories: ReadinessCategory[] = [
    {
      key: 'completeness',
      label: 'Completeness',
      weight: 25,
      score: round(completenessScore),
      reason: missingFields.length || missingProductionEvidence.length
        ? `Missing: ${[...missingFields, ...missingProductionEvidence.map((item) => `${item.label} for ${requiredStage}`)].join(', ')}`
        : 'All required project fields and stage evidence present',
    },
    { key: 'consistency', label: 'Consistency', weight: 20, score: round(consistencyScore), reason: openConflicts.length ? `${openConflicts.length} unresolved conflict(s)` : 'No unresolved conflicts' },
    { key: 'factual', label: 'Factual support', weight: 20, score: round(factualScore), reason: claims.length ? `${approvedClaims.length}/${claims.length} claims approved` : `${facts.length} approved fact(s)` },
    { key: 'rights', label: 'Rights clearance', weight: 15, score: round(rightsScore), reason: riskyAssets.length ? `${riskyAssets.length}/${assets.length} asset(s) with rights risk` : `${assets.length} asset(s) checked` },
    { key: 'brand', label: 'Brand fit', weight: 10, score: round(brandScore), reason: `${brandRules.length} approved brand rule(s)` },
    { key: 'accessibility', label: 'Accessibility', weight: 5, score: round(a11yScore), reason: a11yInputs.length ? `${a11yInputs.length} requirement(s) recorded` : 'No accessibility requirements recorded' },
    { key: 'budget', label: 'Budget feasibility', weight: 5, score: round(budgetScore), reason: !hasBudget ? 'No budget set' : budgetFeasible ? `Remaining ${project.budget.remaining} covers planned ${plannedCost}` : `Planned ${plannedCost} > remaining ${project.budget.remaining}` },
  ];

  const score = round(categories.reduce((sum, c) => sum + c.score, 0));

  const approvalGate = {
    required: contract?.requiredApprovals.length ?? 0,
    approved: contract?.requiredApprovals.filter((a) => a.status === 'approved').length ?? 0,
    satisfied: contract ? contract.requiredApprovals.every((a) => a.status === 'approved') : false,
  };

  const authorizationBlockers: Issue[] = [...blockingIssues];
  if (!contract) {
    authorizationBlockers.push({ severity: 'blocker', code: 'missing_contract', message: 'No Production Contract exists for this project.' });
  } else if (contract.status !== 'approved' && contract.status !== 'locked') {
    authorizationBlockers.push({
      severity: 'blocker',
      code: 'unapproved_contract',
      message: `Production Contract v${contract.version} is ${contract.status}; generation requires an approved or locked contract.`,
    });
  }
  if (contract && !approvalGate.satisfied) {
    authorizationBlockers.push({
      severity: 'blocker',
      code: 'pending_contract_approvals',
      message: `${approvalGate.required - approvalGate.approved} required Production Contract approval(s) are still pending.`,
    });
  }
  missingProductionEvidence.forEach((item) => {
    authorizationBlockers.push({
      severity: 'blocker',
      code: `missing_${item.key}`,
      message: `${item.label} is required before the ${requiredStage} stage can be authorized.`,
    });
  });
  if (requiredStage === 'final') {
    const uncleared = assets.filter((a) => ['unknown', 'restricted', 'expired'].includes(a.licenseStatus));
    if (uncleared.length) {
      authorizationBlockers.push({
        severity: 'blocker',
        code: 'uncleared_assets',
        message: `${uncleared.length} asset(s) are not licence-cleared for final generation.`,
        entityIds: uncleared.map((a) => a._id.toString()),
      });
    }
  }

  const categoryAssessment = assessCategoryRubric({ project, inputs, assets, conflicts, contract, requiredStage });
  const categoryBlockers = categoryAssessment.criteria
    .filter((criterion) => criterion.mandatoryBlocker && (criterion.status === 'missing' || criterion.status === 'failed'))
    .map((criterion) => ({
      severity: 'blocker' as const,
      code: `category_${criterion.key}`,
      message: `${criterion.label}: ${criterion.reason}`,
    }));
  authorizationBlockers.push(...categoryBlockers);

  return {
    score,
    categories,
    blockingIssues,
    warnings,
    recommendations: [...new Set(recommendations)],
    missingRequirements: missing,
    approvalGate,
    evidence,
    categoryAssessment,
    productionAuthorization: {
      authorized: authorizationBlockers.length === 0,
      blockers: Array.from(new Map(authorizationBlockers.map((issue) => [`${issue.code}:${issue.message}`, issue])).values()),
    },
    generatedAt: new Date(),
    source: 'rule_engine',
  };
}

function assessCategoryRubric(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  assets: IAsset[];
  conflicts: IConflict[];
  contract?: IProductionContract | null;
  requiredStage: LadderStage;
}): ReadinessReport['categoryAssessment'] {
  const { project, inputs, assets, conflicts, contract, requiredStage } = opts;
  const text = [
    project.title,
    project.description,
    project.objective,
    project.audience,
    project.tone,
    project.callToAction,
    ...inputs.flatMap((input) => [input.title, input.content, ...input.tags]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const category = detectRubricCategory(project.projectType, text);
  if (!category) {
    return {
      category: null,
      criteria: [],
      limitation: 'No supported category-specific signal was found; only the common readiness rubric was applied.',
    };
  }

  const criteria =
    category === 'food'
      ? foodCriteria({ text, inputs, contract, requiredStage })
      : category === 'tutorial'
        ? tutorialCriteria({ text, inputs, contract, requiredStage })
        : category === 'advertisement'
          ? advertisementCriteria({ text, inputs, assets, contract })
          : category === 'documentary'
            ? documentaryCriteria({ text, inputs, conflicts, assets })
            : socialCriteria({ text, inputs, assets, contract, project, requiredStage });

  return {
    category,
    criteria,
    limitation: 'Category-specific criteria are reported separately and do not add new score weights in this phase.',
  };
}

function detectRubricCategory(projectType: IProject['projectType'], text: string): RubricCategory | null {
  if (projectType === 'ad') return 'advertisement';
  if (projectType === 'social_post') return 'social_creator';
  if (projectType !== 'video') return null;
  if (/\b(recipe|cooking|cook|ingredient|biryani|bake|baking|kitchen|dish|meal)\b/.test(text)) return 'food';
  if (/\b(tutorial|how to|step[- ]by[- ]step|lesson|course|teach|software|coding|code|screen recording|walkthrough)\b/.test(text)) {
    return 'tutorial';
  }
  if (/\b(documentary|interview|archive|historical|investigative|real story|oral history)\b/.test(text)) return 'documentary';
  if (/\b(creator|influencer|reel|shorts|tiktok|instagram|youtube)\b/.test(text)) return 'social_creator';
  return null;
}

function criterion(
  key: string,
  label: string,
  status: EvidenceStatus,
  method: AssessmentMethod,
  reason: string,
  options: Partial<ReadinessEvidence> = {}
): ReadinessEvidence {
  return {
    key,
    label,
    status,
    method,
    reason,
    scoreImpact: 0,
    ...options,
  };
}

function idOf(value: { _id?: unknown } | undefined): string | undefined {
  return value?._id === undefined ? undefined : String(value._id);
}

function findInput(inputs: IKnowledgeInput[], pattern: RegExp): IKnowledgeInput | undefined {
  return inputs.find((input) => pattern.test(`${input.title} ${input.content} ${input.tags.join(' ')}`));
}

function approvedInput(inputs: IKnowledgeInput[], pattern: RegExp): IKnowledgeInput | undefined {
  return inputs.find(
    (input) => input.status === 'approved' && pattern.test(`${input.title} ${input.content} ${input.tags.join(' ')}`)
  );
}

function statusForApprovedEvidence(
  input: IKnowledgeInput | undefined,
  label: string,
  missingReason: string
): ReadinessEvidence {
  if (!input) return criterion(label, label, 'missing', 'deterministic', missingReason, { mandatoryBlocker: true });
  if (input.status === 'approved') {
    return criterion(label, label, 'verified', 'deterministic', `Approved Knowledge Ledger input: ${input.title}.`, {
      evidenceRef: `KnowledgeInput:${idOf(input) ?? input.title}`,
    });
  }
  if (input.status === 'expired' || input.status === 'disputed') {
    return criterion(label, label, 'failed', 'deterministic', `Knowledge Ledger input "${input.title}" is ${input.status}.`, {
      evidenceRef: `KnowledgeInput:${idOf(input) ?? input.title}`,
      mandatoryBlocker: true,
    });
  }
  return criterion(label, label, 'unknown', 'deterministic', `Knowledge Ledger input "${input.title}" exists but is not approved.`, {
    evidenceRef: `KnowledgeInput:${idOf(input) ?? input.title}`,
  });
}

function productionEvidenceStatus(
  contract: IProductionContract | null | undefined,
  requiredStage: LadderStage,
  kind: 'script' | 'storyboard'
): ReadinessEvidence {
  const required = kind === 'script'
    ? ['script', 'storyboard', 'preview', 'final'].includes(requiredStage)
    : ['storyboard', 'preview', 'final'].includes(requiredStage);
  const present = kind === 'script'
    ? Boolean(contract?.contentPlan.script.trim())
    : Boolean(contract?.contentPlan.storyboard.length);
  const label = kind === 'script' ? 'Production script' : 'Storyboard coverage';
  if (!required) return criterion(kind, label, 'not_applicable', 'deterministic', `Not required for the ${requiredStage} stage.`);
  if (!present) return criterion(kind, label, 'missing', 'deterministic', `No ${kind} is present in the current Production Contract.`, {
    mandatoryBlocker: true,
    evidenceRef: contract ? `ProductionContract:v${contract.version}` : undefined,
  });
  return criterion(kind, label, 'unknown', 'human_required', `${label} exists, but content coverage requires human review or a dedicated evaluator.`, {
    evidenceRef: `ProductionContract:v${contract?.version ?? 'unknown'}`,
  });
}

function foodCriteria(opts: {
  text: string;
  inputs: IKnowledgeInput[];
  contract?: IProductionContract | null;
  requiredStage: LadderStage;
}): ReadinessEvidence[] {
  const { text, inputs, contract, requiredStage } = opts;
  const recipe = findInput(inputs, /\b(recipe|source|reference|cookbook|url)\b/i);
  const ingredients = findInput(inputs, /\b(ingredient|quantity|cup|tsp|tbsp|gram|kg|ml|litre|liter)\b/i);
  const cookingRelevant = /\b(cook|bake|boil|fry|temperature|minutes?|hours?)\b/.test(text);
  const timeTemperature = cookingRelevant
    ? statusForApprovedEvidence(findInput(inputs, /\b(cook|bake|boil|fry|temperature|minutes?|hours?|°c|°f)\b/i), 'Cooking time and temperature', 'No approved cooking time or temperature evidence is recorded.')
    : criterion('food_cooking_time_temperature', 'Cooking time and temperature', 'not_applicable', 'deterministic', 'The brief does not state a cooking-time or temperature requirement.');
  const servingRelevant = /\b(servings?|serves|portion)\b/.test(text);
  const serving = servingRelevant
    ? statusForApprovedEvidence(findInput(inputs, /\b(servings?|serves|portion)\b/i), 'Serving size', 'Serving size is requested but no approved evidence is recorded.')
    : criterion('food_serving_size', 'Serving size', 'not_applicable', 'deterministic', 'The brief does not specify a serving-size requirement.');
  const safetyInput = findInput(inputs, /\b(food safety|safe to eat|storage|allergen|allergy|dietary|vegan|halal|gluten|nut)\b/i);
  const safety = safetyInput
    ? safetyInput.status === 'approved'
      ? criterion('food_safety_claims', 'Food-safety and dietary claim support', 'unknown', 'human_required', 'A related claim is approved, but the current model does not link it to independent safety evidence.', { evidenceRef: `KnowledgeInput:${idOf(safetyInput) ?? safetyInput.title}`, mandatoryBlocker: true })
      : criterion('food_safety_claims', 'Food-safety and dietary claim support', 'failed', 'deterministic', `Food-safety or dietary evidence "${safetyInput.title}" is not approved.`, { evidenceRef: `KnowledgeInput:${idOf(safetyInput) ?? safetyInput.title}`, mandatoryBlocker: true })
    : criterion('food_safety_claims', 'Food-safety and dietary claim support', 'not_applicable', 'human_required', 'No food-safety, allergen, or dietary claim was found in the brief or ledger.');
  return [
    statusForApprovedEvidence(recipe, 'Recipe or source reference', 'No recipe, source, or reference evidence is recorded.'),
    statusForApprovedEvidence(ingredients, 'Ingredients and quantities', 'No approved ingredient and quantity evidence is recorded.'),
    timeTemperature,
    serving,
    safety,
    productionEvidenceStatus(contract, requiredStage, 'storyboard'),
  ].map((item, index) => ({ ...item, key: `food_${['recipe_source', 'ingredients_quantities', 'cooking_time_temperature', 'serving_size', 'safety_claims', 'scene_coverage'][index]}`, category: 'food' as const }));
}

function tutorialCriteria(opts: {
  text: string;
  inputs: IKnowledgeInput[];
  contract?: IProductionContract | null;
  requiredStage: LadderStage;
}): ReadinessEvidence[] {
  const { text, inputs, contract, requiredStage } = opts;
  const objective = statusForApprovedEvidence(
    approvedInput(inputs, /\b(learning objective|lesson objective|learn|outcome)\b/i) || (inputs.length ? undefined : undefined),
    'Learning objective',
    'No approved learning objective is recorded; the project objective alone is not treated as a learning objective.'
  );
  const prerequisitesRelevant = /\b(prerequisite|beginner|assume|before you start)\b/.test(text);
  const prerequisites = prerequisitesRelevant
    ? statusForApprovedEvidence(findInput(inputs, /\b(prerequisite|beginner|assume|before you start)\b/i), 'Prerequisites', 'Prerequisites are implied but no approved prerequisite evidence is recorded.')
    : criterion('tutorial_prerequisites', 'Prerequisites', 'not_applicable', 'deterministic', 'The brief does not specify prerequisites.');
  const script = productionEvidenceStatus(contract, requiredStage, 'script');
  const steps = contract?.contentPlan.script
    ? /\b(step\s*\d+|scene\s*\d+|first|then|next|finally)\b/i.test(contract.contentPlan.script)
      ? criterion('tutorial_ordered_steps', 'Ordered instructional steps', 'verified', 'deterministic', 'The script contains explicit ordered-step markers.', { evidenceRef: `ProductionContract:v${contract.version}` })
      : criterion('tutorial_ordered_steps', 'Ordered instructional steps', 'unknown', 'human_required', 'A script exists, but instructional step completeness requires review.', { evidenceRef: `ProductionContract:v${contract.version}`, mandatoryBlocker: true })
    : criterion('tutorial_ordered_steps', 'Ordered instructional steps', 'missing', 'deterministic', 'No script is available from which to verify ordered instructional steps.', { mandatoryBlocker: true });
  const toolRelevant = /\b(software|app|tool|version|api|code|coding|screen recording)\b/.test(text);
  const toolVersion = toolRelevant
    ? statusForApprovedEvidence(findInput(inputs, /\b(version|release|os|operating system)\b/i), 'Software or tool version', 'A software/tool tutorial is indicated, but no version evidence is recorded.')
    : criterion('tutorial_tool_version', 'Software or tool version', 'not_applicable', 'deterministic', 'No software or tool version requirement is stated.');
  const technicalClaims = inputs.filter((input) => input.type === 'claim');
  const claims = technicalClaims.length
    ? technicalClaims.some((input) => input.status !== 'approved')
      ? criterion('tutorial_technical_claims', 'Technical claim verification', 'failed', 'deterministic', 'One or more technical claims are not approved.', { evidenceRef: `KnowledgeInput:${technicalClaims.map((input) => idOf(input) ?? input.title).join(',')}`, mandatoryBlocker: true })
      : criterion('tutorial_technical_claims', 'Technical claim verification', 'unknown', 'ai_assisted', 'Technical claims are approved in the ledger, but no verification result is attached to this readiness assessment.', { evidenceRef: `KnowledgeInput:${technicalClaims.map((input) => idOf(input) ?? input.title).join(',')}` })
    : criterion('tutorial_technical_claims', 'Technical claim verification', 'not_applicable', 'ai_assisted', 'No technical claims are recorded.');
  return [objective, prerequisites, steps, toolVersion, projectOutcome(opts.text, inputs), criterion('tutorial_demonstration', 'Demonstration or screen-recording coverage', script.status === 'missing' ? 'missing' : 'unknown', 'human_required', script.status === 'missing' ? 'No script is available to define the required demonstration.' : 'The current models do not verify actual demonstration footage.', { mandatoryBlocker: script.status === 'missing' }), claims].map((item, index) => ({ ...item, key: item.key.startsWith('tutorial_') ? item.key : `tutorial_${['learning_objective', 'prerequisites', 'ordered_steps', 'tool_version', 'expected_outcome', 'demonstration', 'technical_claims'][index]}`, category: 'tutorial' as const }));
}

function projectOutcome(text: string, inputs: IKnowledgeInput[]): ReadinessEvidence {
  const outcome = approvedInput(inputs, /\b(outcome|result|success|learn|goal)\b/i);
  if (outcome) return criterion('tutorial_expected_outcome', 'Expected outcome', 'verified', 'deterministic', `Approved outcome input: ${outcome.title}.`, { evidenceRef: `KnowledgeInput:${idOf(outcome) ?? outcome.title}` });
  if (/\b(learn|teach|explain|understand|outcome|result)\b/.test(text)) return criterion('tutorial_expected_outcome', 'Expected outcome', 'unknown', 'human_required', 'An outcome is implied, but no approved expected-outcome record is available.');
  return criterion('tutorial_expected_outcome', 'Expected outcome', 'missing', 'deterministic', 'No expected learning or user outcome is recorded.', { mandatoryBlocker: true });
}

function advertisementCriteria(opts: { text: string; inputs: IKnowledgeInput[]; assets: IAsset[]; contract?: IProductionContract | null }): ReadinessEvidence[] {
  const { text, inputs, assets, contract } = opts;
  const product = findInput(inputs, /\b(product|service|brand|model|sku)\b/i) || (contract?.keyMessage ? contract as unknown as IKnowledgeInput : undefined);
  const claims = inputs.filter((input) => input.type === 'claim');
  const offerRelevant = /\b(price|offer|discount|sale|free|limited|valid until|terms)\b/.test(text);
  const legalRelevant = /\b(disclaimer|legal|regulated|compliance|warning|terms)\b/.test(text) || inputs.some((input) => input.type === 'legal_rule');
  return [
    product
      ? criterion('advertisement_product_identity', 'Product or service identity', 'verified', 'deterministic', 'Product/service identity is present in project evidence.', { evidenceRef: product._id ? `KnowledgeInput:${idOf(product)}` : `ProductionContract:v${contract?.version ?? 'unknown'}` })
      : criterion('advertisement_product_identity', 'Product or service identity', 'missing', 'deterministic', 'No product or service identity is recorded.', { mandatoryBlocker: true }),
    claims.length
      ? claims.some((input) => input.status !== 'approved')
        ? criterion('advertisement_claims', 'Claims and supporting evidence', 'failed', 'deterministic', 'One or more advertising claims are not approved.', { evidenceRef: `KnowledgeInput:${claims.map((input) => idOf(input) ?? input.title).join(',')}`, mandatoryBlocker: true })
        : criterion('advertisement_claims', 'Claims and supporting evidence', 'unknown', 'ai_assisted', 'Claims are approved, but the readiness assessment has no attached claim-verification result.', { evidenceRef: `KnowledgeInput:${claims.map((input) => idOf(input) ?? input.title).join(',')}` })
      : criterion('advertisement_claims', 'Claims and supporting evidence', 'not_applicable', 'ai_assisted', 'No advertising claims are recorded.'),
    offerRelevant ? statusForApprovedEvidence(findInput(inputs, /\b(price|offer|discount|sale|free|terms|valid until)\b/i), 'Offer validity and terms', 'An offer or price is stated but no approved validity/terms evidence is recorded.') : criterion('advertisement_offer', 'Offer validity and terms', 'not_applicable', 'deterministic', 'No offer, price, or time-limited term is stated.'),
    legalRelevant ? statusForApprovedEvidence(findInput(inputs, /\b(disclaimer|legal|regulated|compliance|warning|terms)\b/i), 'Required disclaimers', 'Legal or disclaimer requirements are indicated but no approved requirement is recorded.') : criterion('advertisement_disclaimers', 'Required disclaimers', 'not_applicable', 'human_required', 'No legal or disclaimer requirement is indicated.'),
    projectAudience(opts.text, inputs),
    assets.length && assets.every((asset) => asset.licenseStatus === 'owned' || asset.licenseStatus === 'licensed')
      ? criterion('advertisement_rights_brand', 'Rights and brand constraints', 'verified', 'deterministic', 'All supplied assets have owned/licensed status; brand rules remain covered by the common rubric.', { evidenceRef: `Asset:${assets.map((asset) => idOf(asset) ?? asset.name).join(',')}` })
      : criterion('advertisement_rights_brand', 'Rights and brand constraints', 'unknown', 'human_required', 'Rights or brand evidence is incomplete; the common rights/brand categories remain authoritative.', { mandatoryBlocker: assets.some((asset) => ['restricted', 'expired'].includes(asset.licenseStatus)) }),
  ].map((item, index) => ({
    ...item,
    key: ['advertisement_product_identity', 'advertisement_claims', 'advertisement_offer', 'advertisement_disclaimers', 'advertisement_audience', 'advertisement_rights_brand'][index],
    category: 'advertisement' as const,
  }));
}

function projectAudience(text: string, inputs: IKnowledgeInput[]): ReadinessEvidence {
  const audience = approvedInput(inputs, /\b(audience|customer|buyer|user)\b/i);
  if (audience) return criterion('advertisement_audience', 'Target audience', 'verified', 'deterministic', `Approved audience input: ${audience.title}.`, { evidenceRef: `KnowledgeInput:${idOf(audience) ?? audience.title}` });
  if (/\baudience|customer|buyer|user\b/.test(text)) return criterion('advertisement_audience', 'Target audience', 'unknown', 'human_required', 'An audience is mentioned, but no approved audience record is available.');
  return criterion('advertisement_audience', 'Target audience', 'missing', 'deterministic', 'No target audience evidence is recorded.', { mandatoryBlocker: true });
}

function documentaryCriteria(opts: { text: string; inputs: IKnowledgeInput[]; conflicts: IConflict[]; assets: IAsset[] }): ReadinessEvidence[] {
  const { text, inputs, conflicts, assets } = opts;
  const facts = inputs.filter((input) => input.type === 'fact');
  const attributed = facts.find((input) => input.status === 'approved' && input.sourceReference);
  const peopleRelevant = /\b(interview|participant|guest|person|minor|child|subject)\b/.test(text);
  const disputed = conflicts.some((conflict) => conflict.status === 'open' || conflict.status === 'awaiting_decision') || facts.some((input) => input.status === 'disputed');
  return [
    attributed
      ? criterion('documentary_source_attribution', 'Source attribution', 'verified', 'deterministic', `Approved fact has a source reference: ${attributed.title}.`, { evidenceRef: `KnowledgeInput:${idOf(attributed) ?? attributed.title}` })
      : facts.length
        ? criterion('documentary_source_attribution', 'Source attribution', 'missing', 'deterministic', 'Documentary facts exist but no approved source reference is recorded.', { mandatoryBlocker: true })
        : criterion('documentary_source_attribution', 'Source attribution', 'missing', 'deterministic', 'No documentary factual source is recorded.', { mandatoryBlocker: true }),
    peopleRelevant
      ? criterion('documentary_releases', 'Interview and release requirements', assets.some((asset) => asset.consentRequired && asset.consentStatus === 'approved') ? 'verified' : 'unknown', 'human_required', 'People are indicated, but the asset model does not store a dedicated release record.', { evidenceRef: assets.filter((asset) => asset.consentRequired).map((asset) => `Asset:${idOf(asset) ?? asset.name}`).join(',') || undefined, mandatoryBlocker: true })
      : criterion('documentary_releases', 'Interview and release requirements', 'not_applicable', 'human_required', 'No interview, participant, or person-sensitive signal is present.'),
    /\b(chronolog|timeline|year|history|date)\b/.test(text)
      ? criterion('documentary_chronology', 'Chronology or narrative evidence', 'unknown', 'human_required', 'Chronology is relevant, but no structured timeline evidence exists.')
      : criterion('documentary_chronology', 'Chronology or narrative evidence', 'not_applicable', 'human_required', 'No chronology requirement is indicated.'),
    /\b(privacy|private|minor|child|sensitive|identity)\b/.test(text)
      ? criterion('documentary_privacy', 'Privacy-sensitive content', 'unknown', 'human_required', 'Privacy-sensitive content is indicated, but no dedicated privacy review record exists.', { mandatoryBlocker: true })
      : criterion('documentary_privacy', 'Privacy-sensitive content', 'not_applicable', 'human_required', 'No privacy-sensitive signal is present.'),
    disputed
      ? criterion('documentary_disputed_claims', 'Disputed or consequential claims', 'failed', 'deterministic', 'Open conflicts or disputed facts remain in the documentary evidence.', { mandatoryBlocker: true })
      : criterion('documentary_disputed_claims', 'Disputed or consequential claims', 'unknown', 'human_required', 'No dispute is recorded, but consequential-claim review is not independently persisted.'),
  ].map((item) => ({ ...item, category: 'documentary' as const }));
}

function socialCriteria(opts: { text: string; inputs: IKnowledgeInput[]; assets: IAsset[]; contract?: IProductionContract | null; project: IProject; requiredStage: LadderStage }): ReadinessEvidence[] {
  const { text, inputs, assets, contract, project, requiredStage } = opts;
  const platform = findInput(inputs, /\b(platform|instagram|youtube|tiktok|linkedin|facebook)\b/i) || (/\b(instagram|youtube|tiktok|linkedin|facebook)\b/i.test(text) ? inputs.find((input) => `${input.title} ${input.content}`.match(/\b(instagram|youtube|tiktok|linkedin|facebook)\b/i)) : undefined);
  const durationMatch = `${project.title} ${project.description ?? ''} ${project.objective ?? ''}`.match(/\b(\d+)\s*(?:second|sec|s)\b/i);
  const storyboardTotal = contract?.contentPlan.storyboard.reduce((sum, scene) => sum + (scene.durationSeconds || 0), 0) || 0;
  const duration = durationMatch
    ? storyboardTotal
      ? storyboardTotal === Number(durationMatch[1])
        ? criterion('social_duration', 'Target duration', 'verified', 'deterministic', `Storyboard totals the requested ${durationMatch[1]} seconds.`, { evidenceRef: `ProductionContract:v${contract?.version}` })
        : criterion('social_duration', 'Target duration', 'failed', 'deterministic', `Storyboard totals ${storyboardTotal} seconds, not the requested ${durationMatch[1]} seconds.`, { evidenceRef: `ProductionContract:v${contract?.version}`, mandatoryBlocker: true })
      : criterion('social_duration', 'Target duration', 'missing', 'deterministic', 'A target duration is stated, but no storyboard durations are available.', { mandatoryBlocker: true })
    : criterion('social_duration', 'Target duration', 'unknown', 'deterministic', 'No structured or reliably persisted target duration is available.');
  const musicRelevant = /\b(music|song|track|sound)\b/.test(text) || assets.some((asset) => asset.type === 'audio');
  return [
    platform ? criterion('social_platform', 'Target platform', 'verified', 'deterministic', 'A target platform is present in the brief or ledger.', { evidenceRef: platform._id ? `KnowledgeInput:${idOf(platform)}` : undefined }) : criterion('social_platform', 'Target platform', 'missing', 'deterministic', 'No target platform is recorded for this social/creator project.', { mandatoryBlocker: true }),
    duration,
    criterion('social_aspect_ratio', 'Aspect ratio', 'unknown', 'deterministic', 'No project-level aspect-ratio field is stored; TasteProfile is not part of this readiness input.'),
    /\b(caption|subtitle|accessib)\b/.test(text) ? statusForApprovedEvidence(findInput(inputs, /\b(caption|subtitle|accessib)\b/i), 'Captions and subtitles', 'Captions/subtitles are requested but no approved requirement is recorded.') : criterion('social_captions', 'Captions and subtitles', 'not_applicable', 'deterministic', 'No captions/subtitles requirement is indicated.'),
    musicRelevant ? (assets.filter((asset) => asset.type === 'audio').every((asset) => asset.licenseStatus === 'owned' || asset.licenseStatus === 'licensed') && assets.some((asset) => asset.type === 'audio') ? criterion('social_music_rights', 'Music and asset rights', 'verified', 'deterministic', 'Audio assets in scope have owned/licensed status.') : criterion('social_music_rights', 'Music and asset rights', 'unknown', 'human_required', 'Music or sound is requested, but no cleared audio evidence is available.', { mandatoryBlocker: requiredStage === 'final' })) : criterion('social_music_rights', 'Music and asset rights', 'not_applicable', 'deterministic', 'No music or sound requirement is indicated.'),
    /\b(sponsor|sponsored|paid partnership|brand deal)\b/.test(text) ? statusForApprovedEvidence(findInput(inputs, /\b(sponsor|sponsored|paid partnership|brand deal|disclosure)\b/i), 'Sponsorship disclosure', 'Sponsorship is indicated but no approved disclosure requirement is recorded.') : criterion('social_sponsorship', 'Sponsorship disclosure', 'not_applicable', 'human_required', 'No sponsorship signal is present.'),
    projectAudience(text, inputs),
    productionEvidenceStatus(contract, requiredStage, 'script'),
  ].map((item, index) => ({ ...item, key: item.key.startsWith('social_') ? item.key : `social_${['platform', 'duration', 'aspect_ratio', 'captions', 'music_rights', 'sponsorship', 'audience', 'script'][index]}`, category: 'social_creator' as const }));
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
