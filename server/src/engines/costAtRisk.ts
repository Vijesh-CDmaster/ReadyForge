import { IProject } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IAsset } from '../models/Asset';

export interface CostAtRiskReport {
  plannedCost: number;
  reworkProbability: number; // 0..1
  estimatedLoss: number;
  currency: string;
  reasons: string[];
  recommendedActions: string[];
  nextStage: string;
  signals: Array<{ label: string; contribution: number }>;
  disclaimer: string;
  source: 'ai' | 'rule_engine';
  generatedAt: Date;
}

export function computeCostAtRisk(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  assets: IAsset[];
  regenerationRate?: number; // 0..1 historical
}): CostAtRiskReport {
  const { project, inputs, conflicts, assets, regenerationRate = 0 } = opts;

  const stageCosts: Record<string, number> = { concept: 50, script: 200, storyboard: 450, preview: 700, final: 900 };
  const base = stageCosts[project.projectType] ?? 300;
  const plannedCost = Math.round(base * (project.currentStage === 'final' ? 1 : 0.7) + 100);

  const reasons: string[] = [];
  const recommendedActions: string[] = [];
  const signals: Array<{ label: string; contribution: number }> = [];

  const add = (label: string, contribution: number, reason: string, action?: string) => {
    if (contribution <= 0) return;
    signals.push({ label, contribution: Math.round(contribution * 100) / 100 });
    reasons.push(reason);
    if (action) recommendedActions.push(action);
  };

  const openConflicts = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');
  const criticalConflicts = openConflicts.filter((c) => c.severity === 'critical' || c.severity === 'high');
  add(
    'unresolved_conflicts',
    Math.min(0.3, openConflicts.length * 0.12 + criticalConflicts.length * 0.06),
    `${openConflicts.length} unresolved conflict(s)${criticalConflicts.length ? ` (${criticalConflicts.length} critical/high)` : ''}`,
    `Resolve ${openConflicts.length} conflict${openConflicts.length === 1 ? '' : 's'} in the Conflict Room`
  );

  const missingFields = ['objective', 'audience', 'tone', 'callToAction'].filter(
    (f) => !project[f as 'objective']
  );
  add(
    'missing_fields',
    Math.min(0.16, missingFields.length * 0.05),
    `${missingFields.length} required field(s) missing: ${missingFields.join(', ')}`,
    'Complete the missing project fields'
  );

  const unapprovedClaims = inputs.filter((i) => i.type === 'claim' && i.status !== 'approved');
  add(
    'unsupported_claims',
    Math.min(0.2, unapprovedClaims.length * 0.1),
    `${unapprovedClaims.length} unsupported claim(s)`,
    'Approve claims with sources or rewrite them using approved facts'
  );

  const rightsRisks = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );
  add(
    'rights_risks',
    Math.min(0.25, rightsRisks.length * 0.12),
    `${rightsRisks.length} asset(s) with licence risk (${rightsRisks.map((a) => a.name).join(', ') || 'none'})`,
    'Upload or mark licensed assets in the Rights & Licence Manager'
  );

  add('historical_regen', Math.min(0.2, regenerationRate * 0.2), `Historical regeneration rate ${(regenerationRate * 100).toFixed(0)}%`);

  add(
    'output_complexity',
    project.projectType === 'video' || project.projectType === 'ad' ? 0.08 : 0.03,
    `Project type "${project.projectType}" has moderate output complexity`
  );

  const reworkProbability = Math.min(0.95, Math.round(signals.reduce((s, x) => s + x.contribution, 0.05) * 100) / 100);
  const estimatedLoss = Math.round(plannedCost * reworkProbability);

  if (reworkProbability < 0.1) {
    recommendedActions.length = 0;
    recommendedActions.push('Risk is low — generation is recommended.');
  }

  return {
    plannedCost,
    reworkProbability,
    estimatedLoss,
    currency: project.budget.currency || 'INR',
    reasons: reasons.length ? reasons : ['No significant risk signals detected'],
    recommendedActions,
    nextStage: nextStageLabel(project),
    signals,
    disclaimer: 'Estimate, not a guarantee. Derived from transparent risk signals in this project.',
    source: 'rule_engine',
    generatedAt: new Date(),
  };
}

function nextStageLabel(project: IProject): string {
  const labels: Record<string, string> = {
    concept: 'Script generation',
    script: 'Storyboard generation',
    storyboard: 'Low-cost preview',
    preview: 'Final render',
    final: 'Final render (complete)',
  };
  return labels[project.currentStage] ?? 'Script generation';
}
