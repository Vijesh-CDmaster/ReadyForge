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
import { computePreflightForecast } from '../engines/preflight';
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

/* ================= Pre-Flight Performance Forecast (roadmap 31) ================= */

intelligenceRouter.get(
  '/projects/:id/preflight-forecast',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, conflicts, tasks, contract } = await context(project._id);
    const variants = await CreativeVariant.find({ projectId: project._id });
    const forecast = computePreflightForecast({ project, inputs, conflicts, tasks, contract, variants });
    res.json({ forecast });
  })
);

/* ================= Campaign Experiment Planner (roadmap 32) ================= */

interface ExperimentPlan {
  hypothesis: string;
  arms: Array<{ name: string; changes: string; keepConstant: string }>;
  heldConstant: string[];
  successMetric: string;
  guardrails: string[];
  estimatedCost: number;
  recommendation: string;
}

intelligenceRouter.get(
  '/projects/:id/experiment-plan',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = req.project!;
    const { inputs, contract, tasks } = await context(project._id);
    const variants = await CreativeVariant.find({ projectId: project._id });

    const approvedFacts = inputs
      .filter((i) => i.status === 'approved' && ['fact', 'price', 'claim'].includes(i.type))
      .map((i) => i.content);
    const tone = contract?.tone || project.tone || 'neutral';
    const cta = contract?.callToAction || project.callToAction || '';

    const fallback = (): ExperimentPlan => {
      const variantA = variants[0];
      const variantB = variants[1];
      return {
        hypothesis:
          variantA && variantB
            ? `A ${variantA.tone} hook ("${variantA.hook.slice(0, 60)}") will outperform a ${variantB.tone} hook for this audience without changing approved facts or CTA.`
            : `A premium emotional framing will outperform an offer-led framing for "${project.title}" at the same budget.`,
        arms: [
          {
            name: variantA?.name || 'Variant A — Premium emotional',
            changes: variantA?.hook || 'Premium, calm emotional framing of the approved key message.',
            keepConstant: 'Approved facts, CTA, budget, platform format',
          },
          {
            name: variantB?.name || 'Variant B — Offer-led urgency',
            changes: variantB?.hook || 'Urgency/offer-led framing of the same approved key message.',
            keepConstant: 'Approved facts, CTA, budget, platform format',
          },
        ],
        heldConstant: [
          'Approved facts and claims (no claim differs between arms)',
          `CTA: ${cta || 'unchanged across arms'}`,
          `Tone baseline: ${tone}`,
          'Budget and platform format',
        ],
        successMetric: project.objective?.toLowerCase().includes('sale')
          ? 'Click-through rate to purchase, measured per arm over the test window.'
          : 'Click-through rate to the CTA destination, measured per arm over the test window.',
        guardrails: [
          'Stop the test if either arm drops below the workspace readiness gate.',
          'Do not introduce claims not approved in the Production Contract.',
          'Cap spend at the remaining project budget across both arms.',
        ],
        estimatedCost: 2 * (variants.length ? variants[0].estimatedCost : 35),
        recommendation:
          variants.length >= 2
            ? 'Both variants already exist — run A/B with these two arms and keep every other element constant.'
            : 'Generate the two controlled variants first, then run this experiment with one variable changed.',
      };
    };

    const out = await aiJson<ExperimentPlan>({
      system: `You are ReadyForge's Campaign Experiment Planner.
Propose ONE controlled A/B experiment as a JSON object:
{ hypothesis, arms: [{ name, changes, keepConstant }], heldConstant: [...],
  successMetric, guardrails: [...], estimatedCost, recommendation }.
Exactly 2 arms. Only ONE variable may differ between arms (hook, tone or CTA).
Both arms must use only approved facts — never invent claims, prices or scarcity.
Keep the plan small (2 variants) to control cost.`,
      user: JSON.stringify({
        title: project.title,
        objective: project.objective,
        audience: project.audience,
        tone,
        callToAction: cta,
        existingVariants: variants.map((v) => ({ name: v.name, hook: v.hook, tone: v.tone })),
        approvedFacts,
        budgetRemaining: project.budget.remaining,
        currency: project.budget.currency,
        rejectedOutputs: tasks.filter((t) => t.reviewStatus === 'rejected').length,
      }),
      fallback,
    });

    // The local model often under-delivers the schema (e.g. 1 arm, missing fields).
    // Repair: keep whatever valid fields it produced, fill gaps from the deterministic plan.
    const base = fallback();
    const ai = out.data;
    const isStr = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
    const aiArms = Array.isArray(ai?.arms) ? ai.arms.filter((a) => a && isStr(a.name) && isStr(a.changes)) : [];
    // Accept the model's hypothesis only if it reads like one (a sentence, not a label).
    const goodHypothesis = isStr(ai?.hypothesis) && ai.hypothesis.trim().split(/\s+/).length >= 6;
    const plan: ExperimentPlan = {
      hypothesis: goodHypothesis ? ai.hypothesis : base.hypothesis,
      arms: [...aiArms, ...base.arms].slice(0, 2),
      heldConstant:
        Array.isArray(ai?.heldConstant) && ai.heldConstant.length > 0 ? ai.heldConstant : base.heldConstant,
      successMetric: isStr(ai?.successMetric) ? ai.successMetric : base.successMetric,
      guardrails:
        Array.isArray(ai?.guardrails) && ai.guardrails.length > 0 ? ai.guardrails : base.guardrails,
      estimatedCost:
        typeof ai?.estimatedCost === 'number' && ai.estimatedCost > 0 ? ai.estimatedCost : base.estimatedCost,
      recommendation: isStr(ai?.recommendation) ? ai.recommendation : base.recommendation,
    };
    const fullyAi = goodHypothesis && plan.arms.length === aiArms.length && plan.arms.length >= 2;
    res.json({ plan, aiSource: fullyAi ? out.source : 'rule_engine', model: out.model, disclaimer: 'Experiment planning is AI-assisted decision support — validate metrics against your own analytics.' });
  })
);

/* ================= Brand Drift Detector (roadmap 35) ================= */

intelligenceRouter.get(
  '/workspaces/:id/brand-drift',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const dna = ws.brandDna;

    const projects = await Project.find({ workspaceId: ws._id }).sort('-createdAt').limit(50);
    const projectIds = projects.map((p) => p._id);
    const [tasks, variants] = await Promise.all([
      GenerationTask.find({ projectId: { $in: projectIds }, taskType: { $in: ['script', 'storyboard', 'preview', 'final'] } })
        .sort('-createdAt')
        .limit(40),
      CreativeVariant.find({ projectId: { $in: projectIds } }).sort('-createdAt').limit(20),
    ]);

    const samples = [
      ...tasks.map((t) => ({ text: t.outputText, at: t.createdAt, source: `generated ${t.taskType}` })),
      ...variants.map((v) => ({ text: `${v.hook} ${v.script} ${v.tone}`, at: v.createdAt, source: `variant ${v.name}` })),
    ].filter((s) => s.text);

    const banned = (dna?.bannedWords || []).map((w) => w.toLowerCase().trim()).filter(Boolean);
    const dnaTone = (dna?.tone || '').toLowerCase();
    const brandTone = /premium|calm|quiet|luxur|elegan|refined|minimal/.test(dnaTone);
    const discountWords = ['discount', 'cheap', 'lowest', 'buy now', 'hurry', 'flash sale', '% off', 'deal'];
    const aggressiveWords = ['revolutionary', '10x', 'guaranteed', 'instantly', 'miracle', 'unbeatable', 'best ever'];

    const signals: Array<{ level: 'info' | 'warning' | 'danger'; message: string; evidence: string[] }> = [];
    let drift = 0;

    const bannedHits = new Map<string, string[]>();
    for (const s of samples) {
      const lower = s.text.toLowerCase();
      for (const w of banned) {
        if (lower.includes(w)) {
          const arr = bannedHits.get(w) || [];
          arr.push(s.source);
          bannedHits.set(w, arr);
        }
      }
    }
    for (const [word, where] of bannedHits) {
      drift += 20;
      signals.push({
        level: 'danger',
        message: `Banned word "${word}" appears in ${where.length} recent output(s).`,
        evidence: where.slice(0, 3),
      });
    }

    const recentCount = samples.length;
    const discountHits = samples.filter((s) => discountWords.some((w) => s.text.toLowerCase().includes(w)));
    const aggressiveHits = samples.filter((s) => aggressiveWords.some((w) => s.text.toLowerCase().includes(w)));
    if (brandTone && recentCount >= 6) {
      const share = (discountHits.length + aggressiveHits.length) / recentCount;
      if (share >= 0.4) {
        drift += 30;
        signals.push({
          level: 'danger',
          message: `Brand drift detected: ${Math.round(share * 100)}% of the last ${recentCount} outputs use aggressive/discount language, but Brand DNA defines a ${dnaTone.split(',')[0]} brand.`,
          evidence: [...discountHits.slice(0, 2).map((s) => s.source), ...aggressiveHits.slice(0, 2).map((s) => s.source)],
        });
      } else if (share >= 0.2) {
        drift += 15;
        signals.push({
          level: 'warning',
          message: `${Math.round(share * 10)}% of recent outputs lean salesy versus the declared brand tone — drift is starting.`,
          evidence: discountHits.slice(0, 3).map((s) => s.source),
        });
      } else {
        signals.push({ level: 'info', message: 'Recent outputs stay within the declared brand tone.', evidence: [] });
      }
    } else if (!recentCount) {
      signals.push({ level: 'info', message: 'No generated outputs yet — nothing to drift from.', evidence: [] });
    }

    if (!dna || (!dna.tone && !banned.length)) {
      signals.push({ level: 'warning', message: 'Brand DNA is incomplete — drift cannot be measured. Fill in tone and banned words in Settings.', evidence: [] });
      drift += 10;
    }

    const level = drift >= 45 ? 'drifting' : drift >= 20 ? 'watch' : 'aligned';
    const recommendation =
      level === 'drifting'
        ? 'Review recent campaign strategy or update Brand DNA if the tone shift is intentional — then re-run verification on recent outputs.'
        : level === 'watch'
          ? 'Spot-check the flagged outputs before they reach the next ladder stage.'
          : 'Brand consistency is healthy across recent outputs.';

    res.json({
      level,
      driftScore: Math.min(100, drift),
      window: { outputs: recentCount, since: samples[samples.length - 1]?.at || null },
      signals,
      recommendation,
      disclaimer: 'Drift is measured over a recent sample window, not the whole brand history.',
    });
  })
);

/* ================= Knowledge Decay Detector (roadmap 36) ================= */

function valueTokens(text: string): string[] {
  const matches = text.match(/(?:₹|\$|€)\s?\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?%|\b\d+x\b/g);
  return matches ? matches.map((m) => m.replace(/\s/g, '').toLowerCase()) : [];
}

intelligenceRouter.get(
  '/workspaces/:id/knowledge-decay',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const now = Date.now();
    const DAY = 86_400_000;

    const inputs = await KnowledgeInput.find({ workspaceId: ws._id, status: { $in: ['approved', 'disputed'] } })
      .sort('-updatedAt')
      .limit(500);
    const contracts = await ProductionContract.find({
      workspaceId: ws._id,
      status: { $in: ['approved', 'locked'] },
    }).select('keyMessage contentPlan.script objective audience');
    const contractTexts = contracts.map((c) =>
      `${c.keyMessage || ''} ${c.contentPlan?.script || ''}`.toLowerCase()
    );

    interface DecayedItem {
      id: string;
      title: string;
      type: string;
      reason: 'expired' | 'stale' | 'aging';
      daysOld: number;
      daysToExpiry: number | null;
      usedInCampaigns: number;
      action: string;
    }
    const expired: DecayedItem[] = [];
    const aging: DecayedItem[] = [];

    for (const input of inputs) {
      const base = input.approvedAt || input.updatedAt;
      const daysOld = Math.floor((now - new Date(base).getTime()) / DAY);
      const tokens = valueTokens(input.content);
      const usedIn = contractTexts.filter((t) => tokens.some((tok) => t.includes(tok))).length;
      const hasTokens = tokens.length > 0;

      if (input.expiresAt && new Date(input.expiresAt).getTime() < now) {
        expired.push({
          id: input._id.toString(), title: input.title, type: input.type, reason: 'expired',
          daysOld, daysToExpiry: Math.floor((new Date(input.expiresAt).getTime() - now) / DAY),
          usedInCampaigns: usedIn,
          action: `Expired ${Math.abs(Math.floor((new Date(input.expiresAt).getTime() - now) / DAY))} day(s) ago — re-confirm or withdraw it before it spreads into new contracts.`,
        });
        continue;
      }
      if (input.expiresAt && new Date(input.expiresAt).getTime() - now < 14 * DAY) {
        expired.push({
          id: input._id.toString(), title: input.title, type: input.type, reason: 'aging',
          daysOld, daysToExpiry: Math.floor((new Date(input.expiresAt).getTime() - now) / DAY),
          usedInCampaigns: usedIn,
          action: 'Expiry is imminent — confirm this fact is still valid.',
        });
        continue;
      }
      if (daysOld >= 90 && (hasTokens || usedIn > 0)) {
        aging.push({
          id: input._id.toString(), title: input.title, type: input.type, reason: 'stale',
          daysOld, daysToExpiry: input.expiresAt ? Math.floor((new Date(input.expiresAt).getTime() - now) / DAY) : null,
          usedInCampaigns: usedIn,
          action: `Approved ${daysOld} days ago${usedIn ? ` and referenced by ${usedIn} approved contract(s)` : ''} — confirm the value is still current.`,
        });
      }
    }

    const priority = [...expired, ...aging].sort((a, b) => b.usedInCampaigns - a.usedInCampaigns || a.daysToExpiry! - b.daysToExpiry!);
    res.json({
      expired,
      aging,
      items: priority,
      scanned: inputs.length,
      recommendation: priority.length
        ? `Re-confirm ${priority.length} knowledge item(s) — outdated facts spread fastest through approved contracts.`
        : 'No knowledge decay detected — approved facts are current.',
      disclaimer: 'Decay is heuristic: expiry dates, age since approval and numeric references in approved contracts.',
    });
  })
);

/* ================= Rights Expiry Sentinel (roadmap 37) ================= */

intelligenceRouter.get(
  '/workspaces/:id/rights-sentinel',
  requireWorkspace(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const ws = req.workspace!;
    const now = Date.now();
    const DAY = 86_400_000;

    const assets = await Asset.find({ workspaceId: ws._id });
    const contracts = await ProductionContract.find({ workspaceId: ws._id }).select('approvedAssetIds status projectId');

    interface RightsAlert {
      id: string;
      name: string;
      type: string;
      licenseStatus: string;
      expiryDate: string | null;
      daysLeft: number | null;
      usedInCampaigns: number;
      level: 'danger' | 'warning' | 'info';
      message: string;
      action: string;
    }

    const alerts: RightsAlert[] = [];
    for (const a of assets) {
      const usedIn = contracts.filter((c) => c.approvedAssetIds.some((id) => id.toString() === a._id.toString())).length;

      if (a.licenseExpiry) {
        const daysLeft = Math.floor((new Date(a.licenseExpiry).getTime() - now) / DAY);
        if (daysLeft < 0) {
          alerts.push({
            id: a._id.toString(), name: a.name, type: a.type, licenseStatus: 'expired',
            expiryDate: new Date(a.licenseExpiry).toISOString(), daysLeft, usedInCampaigns: usedIn,
            level: 'danger',
            message: `Licence expired ${Math.abs(daysLeft)} day(s) ago${usedIn ? ` and is used in ${usedIn} campaign(s)` : ''}.`,
            action: 'Renew the licence or take the affected content offline now.',
          });
        } else if (daysLeft <= 30) {
          alerts.push({
            id: a._id.toString(), name: a.name, type: a.type, licenseStatus: a.licenseStatus,
            expiryDate: new Date(a.licenseExpiry).toISOString(), daysLeft, usedInCampaigns: usedIn,
            level: daysLeft <= 7 ? 'danger' : 'warning',
            message: `Licence expires in ${daysLeft} day(s)${usedIn ? ` — used in ${usedIn} campaign(s)` : ''}.`,
            action: daysLeft <= 7 ? 'Renew now or schedule a content refresh before expiry.' : 'Plan renewal or a refresh of the content using this asset.',
          });
        }
      } else if (a.licenseStatus === 'unknown' || a.licenseStatus === 'restricted') {
        alerts.push({
          id: a._id.toString(), name: a.name, type: a.type, licenseStatus: a.licenseStatus,
          expiryDate: null, daysLeft: null, usedInCampaigns: usedIn,
          level: 'warning',
          message: `Licence status is "${a.licenseStatus}" with no recorded expiry${usedIn ? ` — and it is used in ${usedIn} campaign(s)` : ''} — rights cannot be confirmed.`,
          action: 'Record the licence owner, type and expiry, or replace the asset.',
        });
      } else if (a.consentRequired && a.consentStatus !== 'approved') {
        alerts.push({
          id: a._id.toString(), name: a.name, type: a.type, licenseStatus: a.licenseStatus,
          expiryDate: null, daysLeft: null, usedInCampaigns: usedIn,
          level: 'danger',
          message: `Likeness/voice consent is "${a.consentStatus}" — publishing without approval is a rights risk.`,
          action: 'Obtain consent before this asset reaches a final render.',
        });
      }
    }

    alerts.sort((x, y) => (x.daysLeft ?? 9999) - (y.daysLeft ?? 9999));
    const expiring = alerts.filter((a) => a.expiryDate).length;
    res.json({
      alerts,
      expiringSoon: expiring,
      scanned: assets.length,
      recommendation: alerts.length
        ? `${alerts.length} rights issue(s) need attention — the top alert is the most urgent.`
        : 'All assets have confirmed rights — no expiry risk in the next 30 days.',
      disclaimer: 'Rights checks are heuristics from recorded licence metadata, not legal advice.',
    });
  })
);