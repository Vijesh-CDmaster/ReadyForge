import { IProject } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IAsset } from '../models/Asset';
import { IProductionContract } from '../models/ProductionContract';

export interface ReadinessCategory {
  key: string;
  label: string;
  weight: number; // percentage
  score: number; // 0..weight
  reason: string;
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
}): ReadinessReport {
  const { project, inputs, conflicts, assets, contract } = opts;

  const blockingIssues: Issue[] = [];
  const warnings: Issue[] = [];
  const recommendations: string[] = [];
  const missing: string[] = [];

  /* ---- Completeness (25%) ---- */
  const missingFields = REQUIRED_FIELDS.filter((f) => !project[f.field]).map((f) => f.label);
  const hasBudget = project.budget.amount > 0;
  if (!hasBudget) missingFields.push('Budget');
  missing.push(...missingFields.map((m) => `Project field missing: ${m}`));

  const approvedInputs = inputs.filter((i) => i.status === 'approved');
  const requiredKinds = ['audience', 'goal', 'fact'];
  const missingKinds = requiredKinds.filter((k) => !inputs.some((i) => i.type === (k as never)));
  missingKinds.forEach((k) => missing.push(`No knowledge input of type "${k}" yet`));

  const completenessRatio =
    (REQUIRED_FIELDS.filter((f) => Boolean(project[f.field])).length + (hasBudget ? 1 : 0)) /
    (REQUIRED_FIELDS.length + 1);
  const completenessScore = 25 * completenessRatio;
  if (missingFields.length) {
    warnings.push({ severity: 'warning', code: 'missing_fields', message: `Missing required fields: ${missingFields.join(', ')}` });
    recommendations.push('Complete the missing project fields in Project Overview.');
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
        entityIds: unsupportedClaims.map((c) => c._id.toString()),
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
  const plannedCost = estimatePlannedCost(project);
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
    { key: 'completeness', label: 'Completeness', weight: 25, score: round(completenessScore), reason: missingFields.length ? `Missing: ${missingFields.join(', ')}` : 'All required project fields present' },
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

  return {
    score,
    categories,
    blockingIssues,
    warnings,
    recommendations: [...new Set(recommendations)],
    missingRequirements: missing,
    approvalGate,
    generatedAt: new Date(),
    source: 'rule_engine',
  };
}

function estimatePlannedCost(project: IProject): number {
  const base: Record<string, number> = {
    video: 900,
    ad: 700,
    social_post: 150,
    blog: 200,
    presentation: 350,
    landing_page: 400,
    custom: 300,
  };
  return base[project.projectType] ?? 300;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
