import { IProject } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IAsset } from '../models/Asset';
import { IGenerationTask } from '../models/GenerationTask';

/**
 * Campaign Risk Score (Enhancement 2)
 *
 * A single 0–100 number: how dangerous is it to generate this campaign right now?
 * It is the inverse orientation of the Readiness Score — judges and leads read one
 * number and know the action. Bands follow the spec:
 *   0–25  low risk     → Generate
 *   26–50 moderate     → Warn
 *   51–75 high         → Require approval
 *   76–100 critical    → Block generation
 *
 * Every point is attributable to a named factor so the score stays explainable.
 */

export interface RiskFactor {
  key: string;
  label: string;
  points: number; // 0..max contribution
  max: number;
  detail: string;
}

export type RiskBand = 'low' | 'moderate' | 'high' | 'critical';

export interface CampaignRiskReport {
  score: number; // 0..100 (higher = riskier)
  band: RiskBand;
  action: string;
  factors: RiskFactor[];
  blocking: boolean;
  generatedAt: Date;
  disclaimer: string;
}

export const RISK_BANDS: Array<{ min: number; max: number; band: RiskBand; action: string }> = [
  { min: 0, max: 25, band: 'low', action: 'Generate' },
  { min: 26, max: 50, band: 'moderate', action: 'Warn' },
  { min: 51, max: 75, band: 'high', action: 'Require approval' },
  { min: 76, max: 100, band: 'critical', action: 'Block generation' },
];

export function computeCampaignRisk(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  assets: IAsset[];
  tasks?: IGenerationTask[];
}): CampaignRiskReport {
  const { project, inputs, conflicts, assets, tasks = [] } = opts;
  const factors: RiskFactor[] = [];

  const add = (key: string, label: string, points: number, max: number, detail: string) => {
    const p = Math.max(0, Math.round(Math.min(points, max)));
    if (p > 0) factors.push({ key, label, points: p, max, detail });
  };

  /* Conflicting inputs (max 30) */
  const open = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');
  const criticalOpen = open.filter((c) => c.severity === 'critical' || c.severity === 'high');
  add(
    'conflicts',
    'Unresolved conflicts',
    open.length * 8 + criticalOpen.length * 6,
    30,
    `${open.length} open conflict(s)${criticalOpen.length ? ` incl. ${criticalOpen.length} high/critical` : ''}`
  );

  /* Unsupported claims (max 20) */
  const claims = inputs.filter((i) => i.type === 'claim');
  const unapproved = claims.filter((i) => i.status !== 'approved' && i.status !== 'rejected');
  add(
    'claims',
    'Unsupported claims',
    unapproved.length * 12,
    20,
    claims.length
      ? `${unapproved.length}/${claims.length} claim(s) not approved`
      : 'No approved claims recorded — factual grounding is thin'
  );

  /* Unlicensed assets (max 25) */
  const riskyAssets = assets.filter(
    (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
  );
  const hardBlocked = riskyAssets.filter((a) => a.licenseStatus === 'restricted' || a.licenseStatus === 'expired');
  add(
    'rights',
    'Unlicensed assets',
    riskyAssets.length * 10 + hardBlocked.length * 5,
    25,
    riskyAssets.length
      ? `${riskyAssets.map((a) => a.name).join(', ')} — ${riskyAssets.length} licence risk(s)`
      : ''
  );

  /* Missing audience / goal (max 15) */
  const missingCore: string[] = [];
  if (!project.audience) missingCore.push('audience');
  if (!project.objective) missingCore.push('objective');
  if (!inputs.some((i) => i.type === 'goal')) missingCore.push('goal input');
  if (!inputs.some((i) => i.type === 'audience')) missingCore.push('audience input');
  add(
    'completeness',
    'Missing audience/goal',
    missingCore.length * 5,
    15,
    missingCore.length ? `Missing: ${missingCore.join(', ')}` : ''
  );

  /* Budget overrun (max 20) */
  if (!project.budget.amount) {
    add('budget', 'No budget set', 12, 20, 'Without a budget, cost-at-risk and spend guards cannot run');
  } else if (project.budget.spent > project.budget.amount) {
    add(
      'budget',
      'Budget overrun',
      20,
      20,
      `Spent ${project.budget.spent} of ${project.budget.amount} ${project.budget.currency}`
    );
  } else if (project.budget.remaining < project.budget.amount * 0.15) {
    add('budget', 'Budget nearly exhausted', 10, 20, `Only ${project.budget.remaining} ${project.budget.currency} left`);
  }

  /* Brand mismatch (max 10) */
  const brandRules = inputs.filter(
    (i) => (i.type === 'visual_rule' || i.type === 'constraint') && i.status === 'approved'
  );
  if (brandRules.length < 2) {
    add('brand', 'Weak brand rules', 10 - brandRules.length * 4, 10, `${brandRules.length} approved brand rule(s)`);
  }

  /* Regeneration history (max 15) */
  const decided = tasks.filter((t) => t.reviewStatus === 'rejected' || t.reviewStatus === 'changes_requested');
  const finished = tasks.filter((t) => t.reviewStatus !== 'pending');
  if (finished.length) {
    const rate = decided.length / finished.length;
    add(
      'regen',
      'Regeneration history',
      Math.round(rate * 15),
      15,
      `${decided.length}/${finished.length} outputs were returned by reviewers`
    );
  }

  const score = Math.min(100, factors.reduce((s, f) => s + f.points, 0));
  const bandEntry = [...RISK_BANDS].reverse().find((b) => score >= b.min) || RISK_BANDS[0];

  return {
    score,
    band: bandEntry.band,
    action: bandEntry.action,
    factors,
    blocking: bandEntry.band === 'critical',
    generatedAt: new Date(),
    disclaimer:
      'Decision-support score from this project’s own signals — not a guaranteed outcome. Every factor is listed so it can be challenged.',
  };
}