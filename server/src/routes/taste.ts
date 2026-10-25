import { Router } from 'express';
import { z } from 'zod';
import { HydratedDocument } from 'mongoose';
import { requireAuth, AuthedRequest, requireProject } from '../middleware/auth';
import { asyncHandler, validateBody, ApiError } from '../http';
import { audit, clientIp } from '../audit';
import {
  TasteProfile,
  ITasteProfile,
  TASTE_CATEGORIES,
  TasteCategory,
  mergeDna,
} from '../models/TasteProfile';
import {
  TASTE_PRESETS,
  translateMood,
  detectTasteConflicts,
  generateMoodBoard,
  creativeBreaker,
  computeConfidence,
  adaptiveQuestionCount,
} from '../ai/taste';
import { Project } from '../models/Project';
import { Workspace } from '../models/Workspace';
import { Asset } from '../models/Asset';

export const tasteRouter = Router();
tasteRouter.use(requireAuth);

/* ---------------- helpers ---------------- */

async function getUserProfile(
  userId: unknown,
  create = false
): Promise<HydratedDocument<ITasteProfile>> {
  let profile = await TasteProfile.findOne({ userId, projectId: { $exists: false } });
  if (!profile && create) profile = await TasteProfile.create({ userId });
  if (!profile) throw new ApiError(404, 'Taste profile not found');
  return profile;
}

async function getProjectOverride(
  userId: unknown,
  projectId: unknown
): Promise<HydratedDocument<ITasteProfile> | null> {
  return TasteProfile.findOne({ userId, projectId });
}

function serializeProfile(
  user: ITasteProfile,
  projectOverride: ITasteProfile | null,
  projectId?: string
) {
  const dna = mergeDna(user.dna as Record<string, any>, (projectOverride?.dna as Record<string, any>) ?? undefined);
  const confidence = computeConfidence(user);
  return {
    dna,
    baseDna: user.dna,
    projectDna: projectOverride?.dna ?? null,
    projectId: projectId ?? null,
    adherence: projectOverride?.adherence ?? user.adherence,
    explorationMode: projectOverride?.explorationMode ?? user.explorationMode,
    stats: user.stats,
    confidence,
    onboardedAt: user.onboardedAt ?? null,
    updatedAt: user.updatedAt,
  };
}

function pushHistory(
  profile: HydratedDocument<ITasteProfile>,
  entry: { category?: TasteCategory; summary: string; source?: string; scope?: 'user' | 'project'; projectId?: unknown; remember?: boolean }
) {
  profile.history.unshift({
    at: new Date(),
    category: entry.category,
    summary: entry.summary,
    source: (entry.source as never) ?? 'manual',
    scope: entry.scope ?? 'user',
    projectId: entry.projectId as never,
    remember: entry.remember ?? true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (profile.history.length > 100) profile.history.length = 100;
}

const dnaPatchSchema = z.record(z.any());

/* ---------------- core profile (#1–#10, #12, #13) ---------------- */

tasteRouter.get(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
    const user = await getUserProfile(req.user!._id, true);
    const override = projectId ? await getProjectOverride(req.user!._id, projectId) : null;
    if (projectId) {
      const project = await Project.findById(projectId);
      if (!project) throw new ApiError(404, 'Project not found');
    }
    res.json(serializeProfile(user, override, projectId));
  })
);

const updateSchema = z.object({
  dna: dnaPatchSchema.optional(),
  adherence: z.enum(['low', 'medium', 'high']).optional(),
  explorationMode: z.enum(['new', 'close', 'mix']).optional(),
  /** "Remember this choice?" (#16) — false = apply for this render only, no history. */
  remember: z.boolean().optional(),
  source: z.enum(['manual', 'learned', 'preset', 'mood', 'onboarding']).optional(),
  onboarded: z.boolean().optional(),
});

tasteRouter.put(
  '/',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(updateSchema, req.body);
    const profile = await getUserProfile(req.user!._id, true);

    if (body.dna) {
      for (const key of Object.keys(body.dna)) {
        if (!TASTE_CATEGORIES.includes(key as TasteCategory)) {
          throw new ApiError(400, `Unknown taste category: ${key}`);
        }
      }
      profile.dna = mergeDna(profile.dna as Record<string, any>, body.dna as Record<string, any>) as never;
      if (body.remember !== false) {
        for (const key of Object.keys(body.dna)) {
          pushHistory(profile, {
            category: key as TasteCategory,
            summary: `Updated ${(key as TasteCategory).toUpperCase()} preferences`,
            source: body.source ?? 'manual',
            remember: true,
          });
        }
      }
    }
    if (body.adherence) {
      profile.adherence = body.adherence;
      if (body.remember !== false) {
        pushHistory(profile, { summary: `Taste adherence set to ${body.adherence}`, source: body.source ?? 'manual' });
      }
    }
    if (body.explorationMode) {
      profile.explorationMode = body.explorationMode;
      if (body.remember !== false) {
        pushHistory(profile, { summary: `Exploration mode set to ${body.explorationMode}`, source: body.source ?? 'manual' });
      }
    }
    if (body.onboarded && !profile.onboardedAt) {
      profile.onboardedAt = new Date();
      pushHistory(profile, { summary: 'Completed Creative Taste onboarding', source: 'onboarding' });
    }

    await profile.save();
    res.json(serializeProfile(profile, null));
  })
);

/* ---------------- per-project override ---------------- */

tasteRouter.put(
  '/project/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(updateSchema, req.body);
    const projectId = req.project!._id;
    let override = await getProjectOverride(req.user!._id, projectId);
    if (!override) override = await TasteProfile.create({ userId: req.user!._id, projectId });

    if (body.dna) {
      for (const key of Object.keys(body.dna)) {
        if (!TASTE_CATEGORIES.includes(key as TasteCategory)) throw new ApiError(400, `Unknown taste category: ${key}`);
      }
      override.dna = mergeDna(override.dna as Record<string, any>, body.dna as Record<string, any>) as never;
    }
    if (body.adherence) override.adherence = body.adherence;
    if (body.explorationMode) override.explorationMode = body.explorationMode;
    await override.save();

    const user = await getUserProfile(req.user!._id, true);
    pushHistory(user, {
      summary: `Project taste override saved for "${req.project!.title}"`,
      source: body.source ?? 'manual',
      scope: 'project',
      projectId,
      remember: true,
    });
    await user.save();

    res.json(serializeProfile(user, override, String(projectId)));
  })
);

tasteRouter.delete(
  '/project/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    await TasteProfile.deleteOne({ userId: req.user!._id, projectId: req.project!._id });
    res.json({ ok: true });
  })
);

/* ---------------- mood translator (#11) ---------------- */

tasteRouter.post(
  '/mood',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(
      z.object({
        mood: z.string().min(2).max(300),
        platform: z.string().max(80).optional(),
        apply: z.boolean().optional(),
        projectId: z.string().optional(),
      }),
      req.body
    );
    const result = await translateMood(body.mood, { platform: body.platform });
    let applied = false;

    if (body.apply) {
      const profile = await getUserProfile(req.user!._id, true);
      const d = result.direction;
      profile.dna = mergeDna(profile.dna as Record<string, any>, {
        visual: { palette: d.color.split(',').map((s) => s.trim()).slice(0, 4), mood: body.mood },
        motion: { energy: /fast|energetic|bold|festive/i.test(body.mood) ? 'fast' : 'calm' },
        sound: { mood: d.music.slice(0, 60) },
        rhythm: { pacing: d.pacing },
        story: { narrativeStyle: d.story },
      } as Record<string, any>) as never;
      pushHistory(profile, { summary: `Mood "${body.mood}" translated into the profile`, source: 'mood' });
      profile.onboardedAt = profile.onboardedAt ?? new Date();
      await profile.save();
      applied = true;
    }

    res.json({ direction: result.direction, aiSource: result.source, model: result.model, applied });
  })
);

/* ---------------- mood board (#21) ---------------- */

tasteRouter.post(
  '/moodboard',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ brief: z.string().min(3).max(4000) }), req.body);
    const profile = await TasteProfile.findOne({ userId: req.user!._id, projectId: { $exists: false } });
    const result = await generateMoodBoard(body.brief, profile);
    res.json({ board: result.board, aiSource: result.source, model: result.model });
  })
);

/* ---------------- creative-block breaker (#30) ---------------- */

tasteRouter.post(
  '/breaker',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ stuckOn: z.string().min(2).max(600) }), req.body);
    const profile = await TasteProfile.findOne({ userId: req.user!._id, projectId: { $exists: false } });
    const result = await creativeBreaker(profile, { stuckOn: body.stuckOn });
    res.json({ suggestions: result.suggestions, aiSource: result.source, model: result.model });
  })
);

/* ---------------- taste conflict detector (#14) ---------------- */

tasteRouter.get(
  '/conflicts/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await getUserProfile(req.user!._id, true);
    const override = await getProjectOverride(req.user!._id, req.project!._id);
    const dna = mergeDna(user.dna as Record<string, any>, (override?.dna as Record<string, any>) ?? undefined) as ITasteProfile['dna'];
    const merged: ITasteProfile = { ...user, dna, adherence: override?.adherence ?? user.adherence };
    const conflicts = detectTasteConflicts(merged, req.project!);
    res.json({ conflicts, adherence: merged.adherence, explorationMode: merged.explorationMode });
  })
);

/* ---------------- confidence (#15) ---------------- */

tasteRouter.get(
  '/confidence',
  asyncHandler(async (req: AuthedRequest, res) => {
    const profile = await getUserProfile(req.user!._id, true);
    res.json(computeConfidence(profile));
  })
);

/* ---------------- learning / remember (#16) ---------------- */

const learnSchema = z.object({
  action: z.enum(['accepted', 'edited', 'rejected']),
  category: z.enum(TASTE_CATEGORIES).optional(),
  note: z.string().max(300).optional(),
});

tasteRouter.post(
  '/learn',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(learnSchema, req.body);
    const profile = await getUserProfile(req.user!._id, true);
    if (body.action === 'accepted') profile.stats.acceptedOutputs += 1;
    if (body.action === 'edited') profile.stats.edits += 1;
    if (body.action === 'rejected') profile.stats.rejections += 1;

    pushHistory(profile, {
      category: body.category,
      summary: body.note ?? `Output ${body.action} — taste learning updated`,
      source: 'learned',
    });
    await profile.save();
    res.json({ stats: profile.stats, confidence: computeConfidence(profile) });
  })
);

/* ---------------- reset (#17) & history (#18) ---------------- */

tasteRouter.post(
  '/reset',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ scope: z.enum(['user', 'project']).default('user'), projectId: z.string().optional() }), req.body);
    if (body.scope === 'project') {
      if (!body.projectId) throw new ApiError(400, 'projectId is required for project reset');
      await TasteProfile.deleteOne({ userId: req.user!._id, projectId: body.projectId });
      res.json({ ok: true, scope: 'project' });
      return;
    }
    const profile = await getUserProfile(req.user!._id, true);
    profile.dna = {} as never;
    profile.adherence = 'medium';
    profile.explorationMode = 'close';
    profile.stats = { acceptedOutputs: 0, edits: 0, rejections: 0 };
    pushHistory(profile, { summary: 'Taste Profile reset to defaults', source: 'manual' });
    await profile.save();
    res.json({ ok: true, scope: 'user', confidence: computeConfidence(profile) });
  })
);

tasteRouter.get(
  '/history',
  asyncHandler(async (req: AuthedRequest, res) => {
    const profile = await getUserProfile(req.user!._id, true);
    res.json({
      history: profile.history.slice(0, 50).map((h) => ({
        id: String(h._id),
        at: h.at,
        category: h.category ?? null,
        summary: h.summary,
        source: h.source,
        scope: h.scope,
        remember: h.remember,
      })),
    });
  })
);

/* ---------------- presets (#23–#25) ---------------- */

tasteRouter.get(
  '/presets',
  asyncHandler(async (_req, res) => {
    const type = _req.query.type as string | undefined;
    res.json({ presets: TASTE_PRESETS.filter((p) => !type || p.type === type) });
  })
);

tasteRouter.post(
  '/presets/apply',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(
      z.object({ presetId: z.string().min(1), projectId: z.string().optional() }),
      req.body
    );
    const preset = TASTE_PRESETS.find((p) => p.id === body.presetId);
    if (!preset) throw new ApiError(404, 'Preset not found');

    if (body.projectId) {
      const project = await Project.findById(body.projectId);
      if (!project) throw new ApiError(404, 'Project not found');
      let override = await getProjectOverride(req.user!._id, project._id);
      if (!override) override = await TasteProfile.create({ userId: req.user!._id, projectId: project._id });
      override.dna = mergeDna(override.dna as Record<string, any>, preset.dna) as never;
      await override.save();
      const user = await getUserProfile(req.user!._id, true);
      pushHistory(user, { summary: `Applied preset "${preset.label}" to project`, source: 'preset', scope: 'project', projectId: project._id });
      await user.save();
      res.json({ ok: true, preset, scope: 'project' });
      return;
    }

    const profile = await getUserProfile(req.user!._id, true);
    profile.dna = mergeDna(profile.dna as Record<string, any>, preset.dna) as never;
    pushHistory(profile, { summary: `Applied preset "${preset.label}"`, source: 'preset' });
    await profile.save();
    res.json({ ok: true, preset, scope: 'user', confidence: computeConfidence(profile) });
  })
);

/* ---------------- team taste insights (#26) ---------------- */

tasteRouter.get(
  '/insights/:workspaceId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const workspace = await Workspace.findById(req.params.workspaceId);
    if (!workspace) throw new ApiError(404, 'Workspace not found');
    const member = workspace.members.find(
      (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
    );
    if (!member && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Not a member of this workspace');

    const profiles = await TasteProfile.find({
      userId: { $in: workspace.members.filter((m) => m.status === 'active').map((m) => m.userId) },
      projectId: { $exists: false },
    });

    const tally = (get: (p: ITasteProfile) => string[]) => {
      const counts = new Map<string, number>();
      for (const p of profiles) for (const v of get(p)) counts.set(v, (counts.get(v) ?? 0) + 1);
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));
    };

    res.json({
      members: profiles.length,
      sharedVisualMoods: tally((p) => ((p.dna.visual as { mood?: string }).mood ? [(p.dna.visual as { mood?: string }).mood!] : [])),
      commonPalettes: tally((p) => ((p.dna.visual as { palette?: string[] }).palette ?? [])),
      commonMotionEnergy: tally((p) => ((p.dna.motion as { energy?: string }).energy ? [(p.dna.motion as { energy?: string }).energy!] : [])),
      commonMusicGenres: tally((p) => ((p.dna.sound as { genres?: string[] }).genres ?? [])),
      adherenceSplit: tally((p) => [p.adherence]),
      divergences: describeDivergences(profiles),
      averageConfidence: profiles.length
        ? Math.round(profiles.reduce((s, p) => s + computeConfidence(p).score, 0) / profiles.length)
        : 0,
    });
  })
);

function describeDivergences(profiles: ITasteProfile[]): string[] {
  if (profiles.length < 2) return [];
  const out: string[] = [];
  const energies = new Set(profiles.map((p) => (p.dna.motion as { energy?: string }).energy).filter(Boolean));
  if (energies.size > 1) out.push(`Motion energy differs across the team (${[...energies].join(', ')}) — agree on a default before generating.`);
  const hooks = new Set(profiles.map((p) => (p.dna.rhythm as { hookSpeed?: string }).hookSpeed).filter(Boolean));
  if (hooks.size > 1) out.push(`Hook speed preferences diverge (${[...hooks].join(', ')}) — consider taste-based variants.`);
  const adh = new Set(profiles.map((p) => p.adherence));
  if (adh.size > 1) out.push(`Taste adherence differs (${[...adh].join(', ')}) — set expectations before review.`);
  return out;
}

/* ---------------- taste-based asset recommendations (#27) ---------------- */

tasteRouter.get(
  '/recommendations/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await getUserProfile(req.user!._id, true);
    const override = await getProjectOverride(req.user!._id, req.project!._id);
    const dna = mergeDna(user.dna as Record<string, any>, (override?.dna as Record<string, any>) ?? undefined);
    const visual = (dna as any).visual ?? {};
    const tasteTerms = [
      ...(visual.palette ?? []),
      ...(visual.style ?? []),
      ...(visual.imagery ?? []),
      String(visual.mood ?? ''),
      ...((dna as any).motion?.camera ?? []),
    ]
      .join(' ')
      .toLowerCase()
      .split(/[^a-z0-9-]+/)
      .filter((w: string) => w.length > 2);

    const assets = await Asset.find({ projectId: req.project!._id });
    const scored = assets
      .map((a) => {
        const haystack = `${a.name ?? ''} ${a.type ?? ''} ${a.licenseType ?? ''}`.toLowerCase();
        const matches = tasteTerms.filter((t: string) => haystack.includes(t));
        return {
          id: String(a._id),
          name: a.name || 'Untitled asset',
          url: a.fileUrl,
          kind: a.type,
          score: Math.min(100, matches.length * 25 + (matches.length ? 25 : 0)),
          matchedOn: matches,
          licenseStatus: a.licenseStatus,
        };
      })
      .filter((a) => a.score > 0)
      .sort((a, b) => b.score - a.score);

    res.json({
      recommendations: scored,
      tasteTerms: tasteTerms.slice(0, 12),
      note: scored.length
        ? 'Matched against your Visual/Motion DNA. Licence status shown per asset.'
        : 'No assets match your taste terms yet — tag uploads or adjust your Visual DNA.',
    });
  })
);

/* ---------------- personalised question flow (#20) ---------------- */

tasteRouter.get(
  '/questions/:projectId',
  asyncHandler(async (req: AuthedRequest, res) => {
    const project = await Project.findById(req.params.projectId);
    if (!project) throw new ApiError(404, 'Project not found');
    const workspace = await Workspace.findById(project.workspaceId);
    const member = workspace?.members.find(
      (m) => m.userId.toString() === req.user!._id.toString() && m.status === 'active'
    );
    if (!member && req.user!.platformRole !== 'admin') throw new ApiError(403, 'Not a member of this project workspace');

    const profile = await TasteProfile.findOne({ userId: req.user!._id, projectId: { $exists: false } });
    const { count, rationale } = adaptiveQuestionCount(profile);
    res.json({
      count,
      rationale,
      workflow: profile?.dna.workflow ?? null,
      editingMode: (profile?.dna.workflow as { editingMode?: string })?.editingMode ?? 'assisted',
    });
  })
);

/* ---------------- taste-based variant briefs (#19) ---------------- */

tasteRouter.post(
  '/variants/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(z.object({ brief: z.string().max(2000).optional() }), req.body ?? {});
    const user = await getUserProfile(req.user!._id, true);
    const override = await getProjectOverride(req.user!._id, req.project!._id);
    const dna = mergeDna(user.dna as Record<string, any>, (override?.dna as Record<string, any>) ?? undefined);
    const adherence = override?.adherence ?? user.adherence;

    const visual = (dna as any).visual ?? {};
    const motion = (dna as any).motion ?? {};
    const rhythm = (dna as any).rhythm ?? {};
    const sound = (dna as any).sound ?? {};
    const story = (dna as any).story ?? {};

    const variants = [
      {
        name: 'Variant — My taste',
        adherence: adherence as string,
        direction: `Full taste match: ${(visual.palette ?? []).slice(0, 3).join(', ') || 'your palette'}; ${motion.energy ?? 'medium'} motion; ${rhythm.hookSpeed ?? 'medium'} hook.`,
        hookStyle: rhythm.hookSpeed === 'fast' ? 'Immediate hook in the first second' : 'Open with atmosphere, then the hook',
        pacing: rhythm.preferredLength || rhythm.energyCurve || 'your standard pacing',
        music: (sound.genres ?? []).join(', ') || 'your usual music direction',
        storyShape: (story.structure ?? []).join(' → ') || 'problem → solution',
      },
      {
        name: 'Variant — Opposite pole',
        adherence: 'low',
        direction: `Deliberate departure from your profile: ${(visual.palette ?? []).length ? 'invert the palette temperature' : 'try a high-contrast palette'}; ${motion.energy === 'calm' ? 'energetic fast cuts' : 'calm slow reveals'}.`,
        hookStyle: rhythm.hookSpeed === 'fast' ? 'Slow atmospheric open' : 'Pattern-interrupt cold open',
        pacing: 'contrast pacing vs your norm',
        music: (sound.genres ?? []).length ? 'genre you never use' : 'percussion-led track',
        storyShape: story.structure?.[0] === 'question → answer' ? 'before → after' : 'question → answer',
      },
      {
        name: 'Variant — Mix',
        adherence: 'medium',
        direction: `Your taste blended with a new direction (exploration mode: ${user.explorationMode}).`,
        hookStyle: 'Your hook speed with one new visual device',
        pacing: `${rhythm.preferredLength || 'standard'} with one structural surprise`,
        music: `${(sound.genres ?? [])[0] ?? 'ambient'} with an unexpected instrument layer`,
        storyShape: `${(story.structure ?? ['problem → solution'])[0]} reframed as a customer story`,
      },
    ];

    audit({
      workspaceId: req.workspace!._id.toString(),
      projectId: req.project!._id.toString(),
      actorId: req.user!._id.toString(),
      actorType: 'user',
      action: 'taste.variants',
      entityType: 'taste_profile',
      after: { count: variants.length, adherence },
      ipAddress: clientIp(req),
    });

    res.json({ variants, adherence, explorationMode: user.explorationMode });
  })
);

/* ---------------- model routing advice (#28) ---------------- */

tasteRouter.get(
  '/routing/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await getUserProfile(req.user!._id, true);
    const override = await getProjectOverride(req.user!._id, req.project!._id);
    const dna = mergeDna(user.dna as Record<string, any>, (override?.dna as Record<string, any>) ?? undefined) as any;
    const model = dna.model ?? {};
    const preference = model.qualityPreference ?? 'balanced';
    const cost = model.costSensitivity ?? 'medium';

    const advice: string[] = [];
    if ((model.preferredModels ?? []).length) advice.push(`Preferred models: ${model.preferredModels.join(', ')}.`);
    advice.push(
      preference === 'best'
        ? 'Quality-first: route generation to the strongest available model even if slower.'
        : preference === 'fast'
          ? 'Latency-first: route to the fastest model that clears verification.'
          : 'Balanced routing: cost and quality weighted evenly.'
    );
    if (cost === 'high') advice.push('High cost sensitivity: prefer cheaper models; escalate only on verification failure.');
    if (cost === 'low') advice.push('Cost is secondary: escalate to premium models on any rework risk.');

    res.json({ preference, costSensitivity: cost, preferredModels: model.preferredModels ?? [], advice });
  })
);

/* ---------------- workspace/project availability check ---------------- */

tasteRouter.get(
  '/project/:id',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const user = await getUserProfile(req.user!._id, true);
    const override = await getProjectOverride(req.user!._id, req.project!._id);
    res.json(serializeProfile(user, override, String(req.project!._id)));
  })
);
