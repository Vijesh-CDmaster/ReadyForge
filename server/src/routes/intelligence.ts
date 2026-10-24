import { Router } from 'express';
import { z } from 'zod';
import { ApiError, asyncHandler, validateBody } from '../http';
import { audit, clientIp } from '../audit';
import { AuthedRequest, requireAuth, requireProject, requireWorkspace, requireRole } from '../middleware/auth';
import { Project } from '../models/Project';
import { KnowledgeInput } from '../models/KnowledgeInput';
import { Conflict } from '../models/Conflict';
import { Asset } from '../models/Asset';
import { GenerationTask } from '../models/GenerationTask';
import { AiUsageLog } from '../models/AiUsageLog';
import { CreativeVariant } from '../models/CreativeVariant';
import { ProductionContract } from '../models/ProductionContract';
import { computeCampaignRisk } from '../engines/riskScore';
import { computeCostAtRisk } from '../engines/costAtRisk';
import { aiJson } from '../ai/client';

export const intelligenceRouter = Router();
intelligenceRouter.use(requireAuth);

async function context(projectId: unknown) {
  const [inputs, conflicts, assets, tasks, contract] = await Promise.all([
    KnowledgeInput.find({ projectId }),
    Conflict.find({ projectId }),
    Asset.find({ projectId }),
    GenerationTask.find({ projectId }),
    ProductionContract.findOne({ projectId, status: { $ne: 'superseded' } }).sort('-version'),
  ]);
  return { inputs, conflicts, assets, tasks, contract };
}

/* ---------------- Campaign Risk Score ---------------- */

intelligenceRouter.get(
  '/projects/:id/risk-score',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, assets, tasks } = await context(project._id);
    const risk = computeCampaignRisk({ project, inputs, conflicts, assets, tasks });
    const cost = computeCostAtRisk({ project, inputs, conflicts, assets });
    res.json({ risk, wasteReceipt: cost.receipt, plannedCost: cost.plannedCost, currency: cost.currency });
  })
);

/* ---------------- Audience Simulation Panel ---------------- */

interface AudienceRow {
  audience: string;
  likelyReaction: string;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

const SIMULATION_DISCLAIMER =
  'AI-simulated audience feedback for decision support — not a guaranteed real-world outcome.';

intelligenceRouter.post(
  '/projects/:id/audience-simulation',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, contract } = await context(project._id);

    const audienceInputs = inputs.filter((i) => i.type === 'audience' && i.status === 'approved');
    const tone = contract?.tone || project.tone || 'neutral';
    const cta = contract?.callToAction || project.callToAction || '';
    const offerSignals = ['discount', 'off', 'sale', 'free', 'limited', 'offer'].filter((w) =>
      `${contract?.keyMessage || ''} ${project.objective || ''}`.toLowerCase().includes(w)
    );

    const fallback = (): AudienceRow[] => {
      const segments = audienceInputs.length
        ? audienceInputs.slice(0, 3).map((a) => a.content.slice(0, 80))
        : ['Primary audience', 'Price-sensitive segment', 'Enterprise segment'];
      const rows: AudienceRow[] = segments.map((seg) => ({
        audience: seg,
        likelyReaction: `The ${tone} tone should land with this segment${offerSignals.length ? ', but the offer-led framing may dilute it' : ''}.`,
        risk: 'low' as const,
        recommendation: 'Keep the contract tone and CTA consistent for this segment.',
      }));
      rows.push({
        audience: 'Discount-driven buyers',
        likelyReaction: offerSignals.length
          ? 'Offer-led messaging is attractive, but conflicts with a premium tone.'
          : 'No clear price hook — may scroll past.',
        risk: offerSignals.length ? ('medium' as const) : ('high' as const),
        recommendation: offerSignals.length
          ? 'Consider a separate offer-led variant instead of mixing signals.'
          : 'Add a concrete, approved value hook if this segment matters.',
      });
      if (cta) {
        rows.push({
          audience: 'First-time visitors',
          likelyReaction: `CTA "${cta}" gives a clear next step.`,
          risk: 'low' as const,
          recommendation: 'Keep the CTA visible in the first 5 seconds.',
        });
      }
      return rows;
    };

    const out = await aiJson<AudienceRow[]>({
      system: `You are ReadyForge's Audience Simulation Panel.
Given the project and approved audience inputs, return a JSON ARRAY of 3-5 rows.
Each row: { audience, likelyReaction, risk: "low"|"medium"|"high", recommendation }.
Compare how each segment would react to the planned tone and offer. Flag mixed-signal
combinations (e.g. premium tone + discount hook). Never invent product facts.`,
      user: JSON.stringify({
        objective: project.objective,
        tone,
        callToAction: cta,
        audience: project.audience,
        approvedAudienceInputs: audienceInputs.map((a) => a.content),
        keyMessage: contract?.keyMessage || '',
      }),
      fallback,
    });

    res.json({
      rows: Array.isArray(out.data) ? out.data : fallback(),
      aiSource: out.source,
      model: out.model,
      disclaimer: SIMULATION_DISCLAIMER,
    });
  })
);

/* ---------------- Creative Variant Matrix (2 variants) ---------------- */

const VARIANT_COST = 35;

intelligenceRouter.get(
  '/projects/:id/variants',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const variants = await CreativeVariant.find({ projectId: req.project!._id }).sort('createdAt');
    res.json(variants.map((v) => ({ ...v.toObject(), id: v._id.toString() })));
  })
);

intelligenceRouter.post(
  '/projects/:id/variants',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const ws = req.workspace!;
    const user = req.user!;
    const { inputs, contract, assets, conflicts } = await context(project._id);

    if (!contract) throw new ApiError(409, 'Approve a Production Contract before generating variants.');
    if (contract.status !== 'approved') throw new ApiError(409, `Contract is ${contract.status} — variants inherit an approved contract.`);
    const uncleared = assets.filter(
      (a) => a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted' || a.licenseStatus === 'expired'
    );
    if (uncleared.length) {
      throw new ApiError(409, `${uncleared.length} asset(s) are not licence-cleared — variants inherit rights risks.`);
    }
    const openHigh = conflicts.filter(
      (c) => (c.status === 'open' || c.status === 'awaiting_decision') && (c.severity === 'high' || c.severity === 'critical')
    );
    if (openHigh.length) throw new ApiError(409, `${openHigh.length} high/critical conflict(s) must be resolved first.`);

    const existing = await CreativeVariant.find({ projectId: project._id });
    if (existing.length >= 2) throw new ApiError(409, 'Two variants already exist — reject one before regenerating.');

    const approvedFacts = inputs
      .filter((i) => i.status === 'approved' && ['fact', 'price', 'claim'].includes(i.type))
      .map((i) => i.content);

    interface VariantDraft {
      name: string;
      hook: string;
      tone: string;
      audience: string;
      cta: string;
      format: string;
      durationSeconds: number;
      script: string;
    }

    const fallback = (): VariantDraft[] => [
      {
        name: 'Variant A — Premium emotional',
        hook: `${project.title}: made for the ones who notice the details.`,
        tone: contract.tone || 'premium, calm',
        audience: project.audience || 'Quality-focused buyers',
        cta: contract.callToAction || project.callToAction || 'Learn more',
        format: `${project.projectType} · 20s`,
        durationSeconds: 20,
        script: `[OPEN] ${project.objective || project.title}\nHOOK: Slow, warm, confident.\nBODY: Weave in approved facts only:\n${approvedFacts.map((f) => `- ${f}`).join('\n')}\nCTA: ${contract.callToAction || project.callToAction || 'Learn more'}`,
      },
      {
        name: 'Variant B — Offer-led urgency',
        hook: `A clear, approved offer: ${contract.keyMessage || project.title}.`,
        tone: 'urgent, direct',
        audience: 'Offer-responsive buyers',
        cta: contract.callToAction || project.callToAction || 'Act now',
        format: `${project.projectType} · 15s`,
        durationSeconds: 15,
        script: `[OPEN] Attention-first.\nHOOK: Lead with the approved value proposition.\nBODY: Approved facts only:\n${approvedFacts.map((f) => `- ${f}`).join('\n')}\nCTA: ${contract.callToAction || project.callToAction || 'Act now'}\nNOTE: Urgency must not invent scarcity not present in approved inputs.`,
      },
    ];

    const out = await aiJson<VariantDraft[]>({
      system: `You are ReadyForge's Creative Variant Matrix generator.
Return a JSON ARRAY of exactly 2 variants: one premium/emotional, one offer-led/urgent.
Each: { name, hook, tone, audience, cta, format, durationSeconds, script }.
Both variants MUST inherit the same approved facts, brand rules and CTA from the contract.
Never invent facts, prices, discounts or scarcity not present in the approved facts.
Keep each script under 180 words.`,
      user: JSON.stringify({
        title: project.title,
        objective: project.objective,
        projectType: project.projectType,
        contract: {
          tone: contract.tone,
          keyMessage: contract.keyMessage,
          callToAction: contract.callToAction,
          brandRules: contract.brandRules,
        },
        approvedFacts,
      }),
      fallback,
    });

    const drafts = (Array.isArray(out.data) && out.data.length >= 2 ? out.data.slice(0, 2) : fallback());

    const created = await CreativeVariant.insertMany(
      drafts.map((d) => ({
        projectId: project._id,
        workspaceId: ws._id,
        createdById: user._id,
        name: d.name,
        hook: d.hook,
        tone: d.tone,
        audience: d.audience,
        cta: d.cta,
        format: d.format,
        durationSeconds: d.durationSeconds || 0,
        script: d.script,
        status: 'draft' as const,
        estimatedCost: VARIANT_COST,
        actualCost: VARIANT_COST,
        modelName: out.model,
      }))
    );

    await AiUsageLog.create({
      workspaceId: ws._id,
      projectId: project._id,
      userId: user._id,
      provider: out.source === 'ai' ? 'local-llm' : 'local-rules',
      model: out.model,
      taskType: 'variant_matrix',
      outputTokens: Math.round(drafts.reduce((s, d) => s + d.script.length, 0) / 4),
      cost: VARIANT_COST * created.length,
      currency: project.budget.currency,
      status: 'success',
      latencyMs: 0,
    });

    project.budget.spent += VARIANT_COST * created.length;
    project.budget.remaining = Math.max(0, project.budget.remaining - VARIANT_COST * created.length);
    await project.save();

    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'variant.generate',
      entityType: 'creative_variant',
      after: { count: created.length, model: out.model, source: out.source },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      variants: created.map((v) => ({ ...v.toObject(), id: v._id.toString() })),
      aiSource: out.source,
      model: out.model,
      disclaimer: 'Variants inherit the approved contract facts — review before publishing.',
    });
  })
);

const variantReviewSchema = z.object({
  status: z.enum(['approved', 'rejected']),
  comment: z.string().max(2000).optional(),
});

intelligenceRouter.post(
  '/variants/:id/review',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(variantReviewSchema, req.body);
    const variant = await CreativeVariant.findById(req.params.id);
    if (!variant) throw new ApiError(404, 'Variant not found');
    const project = await Project.findById(variant.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const { Workspace } = await import('../models/Workspace');
    const ws = await Workspace.findById(variant.workspaceId);
    const role = ws?.members.find((m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active')?.role;
    if (!role && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Workspace membership required');
    if (!['owner', 'lead', 'reviewer'].includes(role || '')) {
      throw new ApiError(403, 'Only owner, lead or reviewer can decide on variants');
    }

    variant.status = body.status;
    variant.reviewComment = body.comment;
    await variant.save();

    audit({
      workspaceId: variant.workspaceId.toString(),
      projectId: variant.projectId.toString(),
      actorId: req.user!._id.toString(),
      action: `variant.${body.status}`,
      entityType: 'creative_variant',
      entityId: variant._id.toString(),
      after: { status: body.status, comment: body.comment },
      ipAddress: clientIp(req),
    });

    res.json({ variant: { ...variant.toObject(), id: variant._id.toString() } });
  })
);

/* ---------------- Judge Mode: simulate a risky campaign ---------------- */

intelligenceRouter.post(
  '/workspaces/:id/judge-mode',
  requireWorkspace(),
  requireRole('owner', 'lead'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const user = req.user!;

    const project = await Project.create({
      workspaceId: ws._id,
      createdById: user._id,
      title: 'JUDGE MODE — Risky Candle Ad Campaign',
      description:
        'One-click risky demo: conflicting prices, an unsupported growth claim, an unlicensed music asset and no confirmed audience. Watch the Waste Receipt fall as each item is fixed.',
      projectType: 'ad',
      status: 'collecting_inputs',
      mode: 'solo',
      objective: 'Sell handmade candles with an aggressive festive discount push.',
      tone: 'aggressive, urgent',
      callToAction: 'Buy now — 50% off',
      budget: { amount: 1500, currency: ws.settings.defaultCurrency, spent: 0, remaining: 1500 },
    });

    await KnowledgeInput.insertMany([
      {
        projectId: project._id,
        workspaceId: ws._id,
        createdById: user._id,
        type: 'price',
        title: 'Festive price — marketing',
        content: 'Festive price is ₹499 (50% off ₹999).',
        sourceType: 'user_input',
        status: 'approved',
        confidence: 0.8,
      },
      {
        projectId: project._id,
        workspaceId: ws._id,
        createdById: user._id,
        type: 'price',
        title: 'Launch price — sales',
        content: 'Launch price is ₹999 — no discount during the festive window.',
        sourceType: 'user_input',
        status: 'approved',
        confidence: 0.9,
      },
      {
        projectId: project._id,
        workspaceId: ws._id,
        createdById: user._id,
        type: 'claim',
        title: 'Growth claim (unsupported)',
        content: 'Our candles sell 10x faster than any competitor on the market.',
        sourceType: 'user_input',
        status: 'draft',
        confidence: 0.3,
      },
      {
        projectId: project._id,
        workspaceId: ws._id,
        createdById: user._id,
        type: 'goal',
        title: 'Campaign goal',
        content: 'Drive festive-season sales for the handmade candle line.',
        sourceType: 'user_input',
        status: 'approved',
        confidence: 0.9,
      },
    ]);

    await Asset.create({
      workspaceId: ws._id,
      projectId: project._id,
      uploadedById: user._id,
      name: 'trendy-hit-song.mp3',
      type: 'audio',
      fileUrl: '/uploads/judge-mode-placeholder.mp3',
      mimeType: 'audio/mpeg',
      sizeBytes: 4_800_000,
      licenseStatus: 'unknown',
      consentRequired: false,
      consentStatus: 'not_required',
      aiGenerated: false,
    });

    // Trigger conflict detection so the demo opens with real, routed conflicts.
    const { detectConflicts } = await import('../ai/conflicts');
    const inputs = await KnowledgeInput.find({ projectId: project._id });
    const { conflicts: detected } = await detectConflicts(inputs as never);
    for (const d of detected) {
      await Conflict.create({
        projectId: project._id,
        workspaceId: ws._id,
        title: d.title,
        description: d.description,
        severity: d.severity,
        conflictType: d.conflictType,
        detectedBy: 'system',
        inputAId: d.relatedInputIds[0],
        inputBId: d.relatedInputIds[1],
        recommendedAction: d.recommendedAction,
        impactIfUnresolved: d.impactIfUnresolved,
      });
    }

    const fresh = await Project.findById(project._id);
    const [conflicts, allInputs, assets, tasks] = await Promise.all([
      Conflict.find({ projectId: project._id }),
      KnowledgeInput.find({ projectId: project._id }),
      Asset.find({ projectId: project._id }),
      GenerationTask.find({ projectId: project._id }),
    ]);
    const risk = computeCampaignRisk({ project: fresh!, inputs: allInputs, conflicts, assets, tasks });
    const cost = computeCostAtRisk({ project: fresh!, inputs: allInputs, conflicts, assets });

    audit({
      workspaceId: ws._id.toString(),
      projectId: project._id.toString(),
      actorId: user._id.toString(),
      action: 'judge_mode.simulate',
      entityType: 'project',
      entityId: project._id.toString(),
      after: { conflicts: conflicts.length, riskScore: risk.score, expectedWaste: cost.receipt.ifRenderNow.expectedWaste },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      projectId: project._id.toString(),
      conflictsCreated: conflicts.length,
      risk,
      wasteReceipt: cost.receipt,
      checklist: [
        'Resolve the conflicting festive price inputs (one-click recommendation)',
        'Approve or rewrite the unsupported 10x growth claim',
        'Licence the unlicensed hit-song.mp3',
        'Confirm the missing audience',
      ],
    });
  })
);