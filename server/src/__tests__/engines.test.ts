import { describe, it, expect } from 'vitest';
import { computeReadiness } from '../engines/readiness';
import { computeCostAtRisk } from '../engines/costAtRisk';
import { computeCampaignRisk, RISK_BANDS } from '../engines/riskScore';
import type { IProject } from '../models/Project';
import type { IKnowledgeInput } from '../models/KnowledgeInput';
import type { IConflict } from '../models/Conflict';
import type { IAsset } from '../models/Asset';

const project = (over: Record<string, unknown> = {}) =>
  ({
    id: 'p1',
    title: 'Test campaign',
    projectType: 'ad',
    status: 'draft',
    currentStage: 'concept',
    mode: 'solo',
    objective: 'Sell candles',
    audience: 'Home buyers',
    tone: 'Warm',
    callToAction: 'Shop now',
    deadline: new Date(Date.now() + 7 * 86400_000),
    budget: { amount: 5000, spent: 0, remaining: 5000, currency: 'INR' },
    ...over,
  }) as unknown as IProject;

const conflict = (over: Record<string, unknown> = {}) =>
  ({ _id: 'c1', severity: 'high', status: 'open', ...over }) as unknown as IConflict;
const input = (over: Record<string, unknown> = {}) =>
  ({ type: 'fact', status: 'approved', title: 'Input', content: 'Some content', tags: [], ...over }) as unknown as IKnowledgeInput;
const asset = (over: Record<string, unknown> = {}) =>
  ({ _id: 'a1', licenseStatus: 'owned', ...over }) as unknown as IAsset;

describe('readiness engine', () => {
  it('scores a complete, conflict-free project higher than an empty one', () => {
    const full = computeReadiness({
      project: project(),
      inputs: [input()],
      conflicts: [],
      assets: [],
    });
    const empty = computeReadiness({
      project: project({ objective: '', audience: '', tone: '', callToAction: '', deadline: null, budget: { amount: 0, spent: 0, remaining: 0, currency: 'INR' } }),
      inputs: [],
      conflicts: [],
      assets: [],
    });
    expect(full.score).toBeGreaterThan(empty.score);
    expect(empty.missingRequirements.length).toBeGreaterThan(0);
  });

  it('always stays within 0..100 and weights categories to 100', () => {
    const report = computeReadiness({ project: project(), inputs: [], conflicts: [], assets: [] });
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
    const totalWeight = report.categories.reduce((s, c) => s + c.weight, 0);
    expect(totalWeight).toBe(100);
  });

  it('raises a blocking issue when a critical conflict is open', () => {
    const report = computeReadiness({
      project: project(),
      inputs: [],
      conflicts: [conflict({ severity: 'critical', status: 'open' })],
      assets: [],
    });
    expect(report.blockingIssues.some((i) => /conflict/i.test(i.message))).toBe(true);
    expect(report.score).toBeLessThan(100);
  });

  it('blocks when an asset licence is restricted or expired, warns when unknown', () => {
    const blocked = computeReadiness({
      project: project(),
      inputs: [],
      conflicts: [],
      assets: [asset({ _id: 'a3', licenseStatus: 'expired' })],
    });
    expect(blocked.blockingIssues.some((i) => i.code === 'unlicensed_asset')).toBe(true);

    const warned = computeReadiness({
      project: project(),
      inputs: [],
      conflicts: [],
      assets: [asset({ _id: 'a2', licenseStatus: 'unknown' })],
    });
    expect(warned.blockingIssues.some((i) => i.code === 'unlicensed_asset')).toBe(false);
    expect(warned.warnings.some((i) => i.code === 'unknown_license')).toBe(true);
  });
});

describe('cost-at-risk / waste receipt', () => {
  it('produces zero-waste floor for a clean project', () => {
    const r = computeCostAtRisk({ project: project(), inputs: [input()], conflicts: [], assets: [] });
    expect(r.plannedCost).toBeGreaterThan(0);
    expect(r.reworkProbability).toBeGreaterThanOrEqual(0);
    expect(r.reworkProbability).toBeLessThanOrEqual(1);
    expect(r.estimatedLoss).toBeLessThanOrEqual(r.plannedCost);
    expect(r.currency).toBe('INR');
    expect(r.disclaimer.length).toBeGreaterThan(0);
  });

  it('waste equals planned cost × rework probability (documented formula)', () => {
    const r = computeCostAtRisk({ project: project(), inputs: [], conflicts: [conflict()], assets: [] });
    expect(r.reworkProbability).toBeGreaterThan(0);
    expect(r.estimatedLoss).toBe(Math.round(r.plannedCost * r.reworkProbability));
    expect(r.receipt.ifRenderNow.expectedWaste).toBe(
      Math.round(r.receipt.ifRenderNow.renderCost * r.receipt.ifRenderNow.reworkProbability)
    );
  });

  it('increases rework probability when conflicts are unresolved', () => {
    const clean = computeCostAtRisk({ project: project(), inputs: [], conflicts: [], assets: [] });
    const messy = computeCostAtRisk({
      project: project(),
      inputs: [],
      conflicts: [conflict(), conflict({ severity: 'critical' })],
      assets: [],
    });
    expect(messy.reworkProbability).toBeGreaterThan(clean.reworkProbability);
    expect(messy.reasons.length).toBeGreaterThan(clean.reasons.length);
  });

  it('after-fixes probability never exceeds if-render-now probability', () => {
    const r = computeCostAtRisk({
      project: project(),
      inputs: [],
      conflicts: [conflict()],
      assets: [asset({ licenseStatus: 'unknown' })],
    });
    expect(r.receipt.afterFixes.reworkProbability).toBeLessThanOrEqual(
      r.receipt.ifRenderNow.reworkProbability
    );
  });
});

describe('campaign risk engine', () => {
  it('a clean project lands in a low band and is not blocking', () => {
    const r = computeCampaignRisk({ project: project(), inputs: [input()], conflicts: [], assets: [] });
    expect(['low', 'moderate']).toContain(r.band);
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.action.length).toBeGreaterThan(0);
  });

  it('open critical conflicts push the score into a higher band with factors', () => {
    const r = computeCampaignRisk({
      project: project(),
      inputs: [input({ type: 'claim', status: 'pending' })],
      conflicts: [conflict(), conflict(), conflict({ severity: 'critical' })],
      assets: [asset({ licenseStatus: 'restricted' })],
    });
    expect(r.score).toBeGreaterThan(25);
    expect(r.factors.length).toBeGreaterThan(0);
    expect(r.factors.every((f) => f.points <= f.max)).toBe(true);
  });

  it('band boundaries match the documented table', () => {
    expect(RISK_BANDS.map((b) => b.band)).toEqual(['low', 'moderate', 'high', 'critical']);
    expect(RISK_BANDS[0].action).toBe('Generate');
    expect(RISK_BANDS[3].action).toBe('Block generation');
  });
});