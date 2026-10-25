import { Types } from 'mongoose';
import { User } from './models/User';
import { Workspace } from './models/Workspace';
import { Project } from './models/Project';
import { KnowledgeInput } from './models/KnowledgeInput';
import { Asset } from './models/Asset';
import { ProductionContract } from './models/ProductionContract';
import { GenerationTask } from './models/GenerationTask';
import { VerificationReport } from './models/VerificationReport';
import { Review } from './models/Review';

export interface DemoPipelineArgs {
  workspaceId: Types.ObjectId;
  projectId: Types.ObjectId;
  objective: string;
  audience: string;
  tone: string;
  demoId: Types.ObjectId;
  leadId: Types.ObjectId;
  approvedInputIds: Types.ObjectId[];
  claimInputId: Types.ObjectId;
  audienceInputId: Types.ObjectId;
  /** Only licensed/owned assets — the unknown-licence track must be excluded. */
  clearedAssetIds: Types.ObjectId[];
}

/**
 * Creates the demo Production Contract, generation history (one rejected
 * attempt + one approved script), verification report, and reviews for the
 * "Product Launch Video" project. Idempotent: does nothing if the project
 * already has a contract. Used by seed() and by topUpDemoPipeline() for demo
 * databases created before this data existed.
 */
export async function ensureDemoPipeline(args: DemoPipelineArgs): Promise<void> {
  if (await ProductionContract.exists({ projectId: args.projectId })) return;

  const contract = await ProductionContract.create({
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    version: 1,
    status: 'approved',
    objective: args.objective,
    audience: args.audience,
    tone: args.tone,
    keyMessage: 'Inkloom helps teams cut campaign setup time by 32%.',
    callToAction: 'Start a free trial of the Campaign Planner',
    approvedClaimIds: args.approvedInputIds,
    approvedAssetIds: args.clearedAssetIds.slice(0, 2),
    brandRules: [
      'Warm off-white background with Inkloom violet #5B4BFF accents.',
      'Tone: confident, minimal — no hype or scarcity language.',
      'Never recolour the Inkloom logo; keep clear space equal to logo height.',
    ],
    accessibilityRequirements: ['Captions required on all video scenes', 'Minimum contrast ratio 4.5:1'],
    localisationRequirements: [],
    contentPlan: {
      outline: [
        'Hook: the 32% setup-time result from the Q2 2025 customer survey',
        'Problem: campaign setup eats a workday every week',
        'Product: Inkloom Campaign Planner walkthrough',
        'Proof: approved pricing — Starter ₹499/month, Pro ₹1,499/month',
        'CTA: start a free trial',
      ],
      script: '',
      storyboard: [],
    },
    modelRoutingPlan: [
      {
        task: 'script-generation',
        preferredModel: 'Qwen/Qwen2.5-0.5B-Instruct',
        fallbackModel: 'readyforge-rules',
        estimatedCost: 12,
        reason: 'Short-form launch script — the small local model is sufficient.',
      },
      {
        task: 'storyboard-generation',
        preferredModel: 'Qwen/Qwen2.5-0.5B-Instruct',
        fallbackModel: 'readyforge-rules',
        estimatedCost: 20,
        reason: 'Scene plan constrained to approved facts and cleared assets.',
      },
    ],
    budgetLimit: 1200,
    requiredApprovals: [
      {
        userId: args.demoId,
        role: 'owner',
        status: 'approved',
        decidedAt: new Date(),
        comment: 'Claims and pricing match the ledger.',
      },
      {
        userId: args.leadId,
        role: 'lead',
        status: 'approved',
        decidedAt: new Date(),
        comment: 'Locked for the launch campaign.',
      },
    ],
    blockers: [],
    createdById: args.leadId,
    approvedAt: new Date(),
  });

  // Rejected first attempt — powers the Regeneration Autopsy demo.
  const rejectedOutline = await GenerationTask.create({
    projectId: args.projectId,
    contractId: contract._id,
    createdById: args.demoId,
    taskType: 'outline',
    stage: 'concept',
    status: 'completed',
    attempt: 1,
    inputPrompt: 'Outline a 60-second launch video for the Inkloom Campaign Planner.',
    modelProvider: 'local',
    modelName: 'Qwen/Qwen2.5-0.5B-Instruct',
    fallbackModel: 'readyforge-rules',
    estimatedCost: 8,
    actualCost: 6.2,
    tokensUsed: 410,
    latencyMs: 2600,
    outputText:
      'OPEN: "Revolutionary AI will 10x your marketing overnight." BODY: generic productivity claims. CTA: buy now.',
    reviewStatus: 'rejected',
    reviewedById: args.leadId,
    reviewedAt: new Date(),
    reviewComment: 'Uses an unsupported growth claim and hype tone.',
    regenerationNotes: 'Unsupported claim "10x" — no approved fact covers it.',
    completedAt: new Date(),
  });

  await Review.create({
    projectId: args.projectId,
    contractId: contract._id,
    generationTaskId: rejectedOutline._id,
    reviewerId: args.leadId,
    decision: 'rejected',
    comment: 'Outline used an unsupported claim and off-brand hype tone.',
    rootCause: 'No approved fact supported "10x growth"; the restricted claim is rejected in the ledger.',
    resolution:
      'Outline regenerated from approved facts only — claim approval is now required before storyboard generation.',
  });

  const scriptTask = await GenerationTask.create({
    projectId: args.projectId,
    contractId: contract._id,
    createdById: args.demoId,
    taskType: 'script',
    stage: 'script',
    status: 'completed',
    attempt: 2,
    inputPrompt: 'Write a 60-second launch script using approved facts only.',
    modelProvider: 'local',
    modelName: 'Qwen/Qwen2.5-0.5B-Instruct',
    fallbackModel: 'readyforge-rules',
    estimatedCost: 12,
    actualCost: 9.4,
    tokensUsed: 612,
    latencyMs: 3820,
    outputText:
      'HOOK: Every campaign starts with a week of setup. Not anymore.\nBODY: Inkloom Campaign Planner turns scattered briefs, facts and approvals into one production contract — teams cut campaign setup time by 32% (survey of 42 customers, Q2 2025). Plans start at ₹499/month.\nCTA: Start a free trial of the Campaign Planner.',
    reviewStatus: 'approved',
    reviewedById: args.leadId,
    reviewedAt: new Date(),
    reviewComment: 'Hook is strong; pricing and the 32% claim match the ledger.',
    completedAt: new Date(),
  });

  await VerificationReport.create({
    projectId: args.projectId,
    contractId: contract._id,
    generationTaskId: scriptTask._id,
    status: 'warning',
    overallScore: 84,
    summary:
      'Script passes claims, intent and brand checks. One rights warning: the demo music track has no recorded licence.',
    checks: [
      {
        checkType: 'claim_verification',
        status: 'passed',
        severity: 'medium',
        message: 'Every numeric claim in the script maps to an approved ledger input.',
        evidence:
          '"cut campaign setup time by 32%" → approved input "Supported claim" (survey of 42 customers, Q2 2025).',
        sourceInputId: args.claimInputId,
      },
      {
        checkType: 'intent_alignment',
        status: 'passed',
        severity: 'high',
        message: 'Script matches the locked objective and audience.',
        evidence:
          'Objective "Drive free-trial signups" → CTA "Start a free trial"; audience matches the approved audience input.',
        sourceInputId: args.audienceInputId,
      },
      {
        checkType: 'brand_fit',
        status: 'passed',
        severity: 'medium',
        message: 'Tone matches the Brand DNA card.',
        evidence: 'Contract tone "Confident, minimal" vs brand tone "premium, calm" — no banned words found.',
      },
      {
        checkType: 'rights',
        status: 'warning',
        severity: 'high',
        message: 'Asset "demo-track.wav" has licence status "unknown" and is not cleared for final render.',
        evidence: 'Asset licence fields: status=unknown, no owner, no expiry recorded.',
        suggestedFix: 'Record the licence owner and expiry for demo-track.wav, or replace it with a cleared track.',
      },
      {
        checkType: 'accessibility',
        status: 'warning',
        severity: 'low',
        message: 'Captions required by the contract are not yet attached to a preview.',
        evidence: 'Contract accessibility requirement: "Captions required on all video scenes".',
        suggestedFix: 'Generate the low-cost preview rung to attach captions before final render.',
      },
    ],
  });

  await Review.create({
    projectId: args.projectId,
    contractId: contract._id,
    generationTaskId: scriptTask._id,
    reviewerId: args.leadId,
    decision: 'approved',
    comment: 'Script approved — claims trace to the ledger and the tone fits the brand.',
  });
}

/**
 * Backfills the demo pipeline into a database that already has the base seed
 * (users/workspace/projects/inputs/assets) but predates this contract data —
 * e.g. demo databases created before the seed was extended.
 */
export async function topUpDemoPipeline(): Promise<void> {
  const demo = await User.findOne({ email: 'demo@readyforge.ai' });
  const lead = await User.findOne({ email: 'lead@readyforge.ai' });
  if (!demo || !lead) return;

  const workspace = await Workspace.findOne({ ownerId: demo._id });
  if (!workspace) return;

  const project = await Project.findOne({
    workspaceId: workspace._id,
    title: 'Product Launch Video',
  });
  if (!project) return;
  if (await ProductionContract.exists({ projectId: project._id })) return;

  const inputs = await KnowledgeInput.find({ projectId: project._id });
  const claim = inputs.find((i) => i.title === 'Supported claim');
  const audience = inputs.find((i) => i.title === 'Primary audience');
  const clearedAssets = await Asset.find({
    projectId: project._id,
    licenseStatus: { $in: ['licensed', 'owned'] },
  });
  if (!claim || !audience || clearedAssets.length < 2) return;

  await ensureDemoPipeline({
    workspaceId: workspace._id,
    projectId: project._id,
    objective: project.objective ?? '',
    audience: project.audience ?? '',
    tone: project.tone ?? '',
    demoId: demo._id,
    leadId: lead._id,
    approvedInputIds: inputs.filter((i) => i.status === 'approved').map((i) => i._id),
    claimInputId: claim._id,
    audienceInputId: audience._id,
    clearedAssetIds: clearedAssets.map((a) => a._id),
  });

  console.log('[seed] contract + generation demo data added to existing workspace');
}