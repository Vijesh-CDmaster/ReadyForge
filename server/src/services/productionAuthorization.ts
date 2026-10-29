import { IProject, LadderStage } from '../models/Project';
import { IKnowledgeInput } from '../models/KnowledgeInput';
import { IConflict } from '../models/Conflict';
import { IAsset } from '../models/Asset';
import { IProductionContract } from '../models/ProductionContract';
import { Issue, ReadinessReport, computeReadiness } from '../engines/readiness';

export interface ProductionAuthorization {
  authorized: boolean;
  blockers: Issue[];
  readiness: ReadinessReport;
}

export function evaluateProductionAuthorization(opts: {
  project: IProject;
  inputs: IKnowledgeInput[];
  conflicts: IConflict[];
  assets: IAsset[];
  contract?: IProductionContract | null;
  stage: LadderStage;
  estimatedCost?: number;
}): ProductionAuthorization {
  const { project, inputs, conflicts, assets, contract, stage, estimatedCost = 0 } = opts;
  const readiness = computeReadiness({
    project,
    inputs,
    conflicts,
    assets,
    contract,
    requiredStage: stage,
  });
  const blockers = readiness.productionAuthorization.blockers.filter(
    (blocker) =>
      (stage !== 'concept' || !blocker.code.startsWith('category_')) &&
      (stage === 'final' || !['unlicensed_asset', 'uncleared_assets'].includes(blocker.code))
  );

  if (!Number.isFinite(estimatedCost) || estimatedCost < 0) {
    blockers.push({
      severity: 'blocker',
      code: 'invalid_budget_estimate',
      message: 'The queued generation has an invalid estimated cost.',
    });
  } else if (estimatedCost > 0) {
    if (!project.budget.amount) {
      blockers.push({
        severity: 'blocker',
        code: 'no_budget',
        message: 'No budget set for this project.',
      });
    } else if (estimatedCost > project.budget.remaining) {
      blockers.push({
        severity: 'blocker',
        code: 'budget_exceeded',
        message: `Estimated cost ${estimatedCost} ${project.budget.currency} exceeds remaining budget ${project.budget.remaining} ${project.budget.currency}.`,
      });
    }
  }

  return {
    authorized: blockers.length === 0,
    blockers: Array.from(new Map(blockers.map((blocker) => [`${blocker.code}:${blocker.message}`, blocker])).values()),
    readiness,
  };
}

export function authorizationMessage(authorization: ProductionAuthorization): string {
  return authorization.blockers.map((blocker) => `${blocker.code}: ${blocker.message}`).join(' ');
}
