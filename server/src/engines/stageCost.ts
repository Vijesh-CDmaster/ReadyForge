import type { LadderStage } from '../models/Project';

/**
 * Canonical production-stage cost ladder.
 *
 * Cost-at-Risk and Readiness must both price a project from its current
 * production stage — never from the deliverable type (video, ad, blog, ...).
 * Keeping the ladder in one module prevents the two engines from drifting.
 */
export const STAGE_BASE_COST: Record<LadderStage, number> = {
  concept: 50,
  script: 200,
  storyboard: 450,
  preview: 700,
  final: 900,
};

/** Base used when a persisted project has no recognised production stage. */
export const UNKNOWN_STAGE_BASE_COST = 300;

const NON_FINAL_MULTIPLIER = 0.7;
const FIXED_OVERHEAD = 100;

/**
 * Planned cost for a production stage.
 *
 * Semantics: non-final stages cost 70% of their base plus a fixed 100
 * overhead; the final stage costs its full base plus the same overhead.
 * Unknown or missing stages fall back to the non-final calculation on a
 * neutral base, matching the original Cost-at-Risk behaviour.
 */
export function computePlannedStageCost(stage: string | null | undefined): number {
  const known = Boolean(stage) && Object.prototype.hasOwnProperty.call(STAGE_BASE_COST, stage as string);
  const base = known ? STAGE_BASE_COST[stage as LadderStage] : UNKNOWN_STAGE_BASE_COST;
  const multiplier = stage === 'final' ? 1 : NON_FINAL_MULTIPLIER;
  return Math.round(base * multiplier + FIXED_OVERHEAD);
}
