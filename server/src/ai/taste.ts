import { aiJson } from './client';
import {
  TasteAdherence,
  ExplorationMode,
  TasteCategory,
  ITasteProfile,
  mergeDna,
  TasteProfile,
} from '../models/TasteProfile';

/* ------------------------------------------------------------------ *
 * Preset catalogs (#23 seasonal, #24 platform, #25 project-type)
 * ------------------------------------------------------------------ */

export interface TastePreset {
  id: string;
  type: 'seasonal' | 'platform' | 'projectType';
  label: string;
  description: string;
  dna: Record<string, Record<string, unknown>>;
}

export const TASTE_PRESETS: TastePreset[] = [
  {
    id: 'seasonal-diwali',
    type: 'seasonal',
    label: 'Diwali festive',
    description: 'Warm, energetic festive direction with gold accents and fast hooks.',
    dna: {
      visual: { palette: ['warm gold', 'deep maroon', 'amber'], mood: 'festive', lighting: 'warm glow', style: ['vibrant'] },
      motion: { energy: 'energetic', intensity: 'high', transitions: ['zoom'] },
      rhythm: { hookSpeed: 'fast', cutFrequency: 'fast' },
      sound: { genres: ['upbeat', 'indian fusion'], mood: 'energetic', tempo: 'fast' },
      story: { structure: ['problem → solution'], emotionalArc: ['joyful'] },
    },
  },
  {
    id: 'seasonal-christmas',
    type: 'seasonal',
    label: 'Christmas warmth',
    description: 'Cosy, emotional, story-led holiday direction.',
    dna: {
      visual: { palette: ['deep red', 'forest green', 'cream'], mood: 'warm', lighting: 'soft' },
      motion: { energy: 'calm', transitions: ['fade'] },
      rhythm: { hookSpeed: 'medium', preferredLength: '30s' },
      sound: { genres: ['acoustic'], mood: 'heartwarming', tempo: 'medium' },
      story: { emotionalArc: ['heartwarming'], structure: ['customer story'] },
    },
  },
  {
    id: 'seasonal-newyear',
    type: 'seasonal',
    label: 'New Year momentum',
    description: 'Bold, forward-looking, high-energy reset messaging.',
    dna: {
      visual: { palette: ['black', 'electric blue', 'white'], mood: 'bold', contrast: 'high' },
      motion: { energy: 'fast', intensity: 'high', transitions: ['glitch'] },
      rhythm: { hookSpeed: 'fast', cutFrequency: 'fast' },
      story: { emotionalArc: ['confident', 'urgent'] },
    },
  },
  {
    id: 'seasonal-summer',
    type: 'seasonal',
    label: 'Summer bright',
    description: 'Light, playful, outdoor-friendly look.',
    dna: {
      visual: { palette: ['sun yellow', 'sky blue', 'white'], lighting: 'bright natural', texture: 'clean' },
      motion: { energy: 'medium', objects: ['floating elements'] },
      sound: { genres: ['upbeat pop'], mood: 'playful' },
    },
  },
  {
    id: 'platform-instagram-reel',
    type: 'platform',
    label: 'Instagram Reel',
    description: 'Fast hook, quick cuts, 15–20 seconds, 9:16.',
    dna: {
      visual: { aspectRatios: ['9:16'], composition: 'dynamic' },
      rhythm: { hookSpeed: 'fast', cutFrequency: 'fast', preferredLength: '15–20s', energyCurve: 'immediate hook' },
      audience: { platform: 'Instagram Reels', attentionSpan: 'short' },
      typography: { textAnimation: ['pop'], captionStyle: 'highlighted keywords' },
    },
  },
  {
    id: 'platform-linkedin',
    type: 'platform',
    label: 'LinkedIn ad',
    description: 'Calm opening, clear message, 30–45 seconds.',
    dna: {
      visual: { aspectRatios: ['1:1', '4:5'], style: ['minimal'], mood: 'premium' },
      rhythm: { hookSpeed: 'medium', cutFrequency: 'medium', preferredLength: '30–45s', energyCurve: 'calm start → clear payoff' },
      audience: { platform: 'LinkedIn', attentionSpan: 'medium', ageGroup: 'professional adults' },
      typography: { fontStyle: 'modern sans-serif', captionStyle: 'minimal' },
      sound: { voiceStyle: 'confident' },
    },
  },
  {
    id: 'platform-youtube',
    type: 'platform',
    label: 'YouTube ad',
    description: 'Story-driven, 45–60 seconds, room to breathe.',
    dna: {
      visual: { aspectRatios: ['16:9'], composition: 'rule-of-thirds' },
      rhythm: { hookSpeed: 'medium', preferredLength: '45–60s', energyCurve: 'slow build → strong ending' },
      audience: { platform: 'YouTube', attentionSpan: 'long' },
      story: { structure: ['problem → solution', 'question → answer'] },
    },
  },
  {
    id: 'platform-product-demo',
    type: 'platform',
    label: 'Product demo',
    description: 'Step-by-step, clear pacing, tutorial storytelling.',
    dna: {
      rhythm: { cutFrequency: 'slow', energyCurve: 'step-by-step' },
      story: { structure: ['tutorial'], narrativeStyle: 'educational' },
      workflow: { explanation: 'detailed' },
      typography: { captionStyle: 'subtitle-style' },
    },
  },
  {
    id: 'project-video',
    type: 'projectType',
    label: 'Video project defaults',
    description: 'Balanced defaults for video and animatic production.',
    dna: {
      motion: { energy: 'medium', intensity: 'medium', camera: ['slow zoom'] },
      rhythm: { sceneDuration: '3–5s', preferredLength: '30s' },
      sound: { genres: ['ambient'], sync: 'mood-based music' },
    },
  },
  {
    id: 'project-social_post',
    type: 'projectType',
    label: 'Social post defaults',
    description: 'Short, punchy, text-forward defaults.',
    dna: {
      visual: { aspectRatios: ['1:1'], composition: 'centered' },
      rhythm: { hookSpeed: 'fast', preferredLength: '15s' },
      typography: { fontStyle: 'bold display', captionStyle: 'bold' },
    },
  },
  {
    id: 'project-ad',
    type: 'projectType',
    label: 'Ad defaults',
    description: 'Hook-first, CTA-led defaults for paid media.',
    dna: {
      rhythm: { hookSpeed: 'fast', energyCurve: 'immediate hook → CTA' },
      story: { structure: ['problem → solution'] },
      audience: { attentionSpan: 'short' },
    },
  },
  {
    id: 'project-blog',
    type: 'projectType',
    label: 'Blog defaults',
    description: 'Readable, structured, text-first defaults.',
    dna: {
      typography: { fontStyle: 'elegant serif', placement: 'left-aligned' },
      story: { structure: ['question → answer'], narrativeStyle: 'educational' },
    },
  },
];

/* ------------------------------------------------------------------ *
 * Mood-to-Style Translator (#11)
 * ------------------------------------------------------------------ */

export interface MoodDirection {
  mood: string;
  color: string;
  motion: string;
  music: string;
  typography: string;
  pacing: string;
  story: string;
  summary: string;
}

const MOOD_RULES: Array<{ match: RegExp; direction: Omit<MoodDirection, 'mood' | 'summary'> }> = [
  {
    match: /premium|calm|luxur|elegan|refined|serene|quiet/i,
    direction: {
      color: 'warm cream and beige neutrals, soft contrast',
      motion: 'slow zoom-ins, soft fades, floating elements',
      music: 'ambient or lo-fi, low volume, gentle tempo',
      typography: 'clean sans-serif, minimal captions',
      pacing: 'calm premium — 15–30s, breathing room between beats',
      story: 'problem → solution with a quiet confident arc',
    },
  },
  {
    match: /festive|celebrat|energetic|party|hype|diwali|carnival/i,
    direction: {
      color: 'warm festive palette — gold, amber, deep red accents',
      motion: 'fast kinetic motion, pop-ins, zoom transitions',
      music: 'upbeat, fast tempo, percussion-forward',
      typography: 'bold display type with highlighted keywords',
      pacing: 'fast cuts, immediate hook, 10–15s',
      story: 'urgency → payoff, joyful emotional arc',
    },
  },
  {
    match: /bold|youth|edgy|rebell|punch|loud/i,
    direction: {
      color: 'high-contrast blocks, saturated accents on dark ground',
      motion: 'energetic, glitch and swipe transitions, high intensity',
      music: 'electronic or trap-influenced, driving tempo',
      typography: 'heavy display type, oversized headlines',
      pacing: 'rapid cuts, hook within the first second',
      story: 'pattern interrupt → bold claim → proof',
    },
  },
  {
    match: /cinematic|emotional|drama|story|documentar/i,
    direction: {
      color: 'filmic tones, teal-orange grade or muted palette',
      motion: 'steady camera moves, orbital and handheld feel, deliberate transitions',
      music: 'orchestral or ambient score building to a resolve',
      typography: 'understated serif or light sans, lower-third placement',
      pacing: 'slow build → strong ending, 45–60s',
      story: 'character-driven arc, tension and release',
    },
  },
  {
    match: /clean|technical|minimal|corporate|professional|simple|clarity/i,
    direction: {
      color: 'white space, single brand accent, neutral greys',
      motion: 'restrained — subtle slide-ins, no gratuitous movement',
      music: 'none or very light ambient bed',
      typography: 'modern sans-serif, small captions, generous leading',
      pacing: 'even step-by-step pacing, 30–45s',
      story: 'question → answer, educational narrative',
    },
  },
  {
    match: /playful|fun|friendly|cute|whimsical/i,
    direction: {
      color: 'pastel or bright candy palette',
      motion: 'bouncy pop-ins, parallax, physics-based motion',
      music: 'plucky upbeat pop, light percussion',
      typography: 'rounded friendly type, animated captions',
      pacing: 'medium-fast with playful pauses',
      story: 'light humour, before → after',
    },
  },
];

/**
 * Converts free-form mood words into concrete creative directions.
 * Rule engine first (deterministic, honest), LLM as an enhancement when configured.
 */
export async function translateMood(mood: string, opts: { platform?: string } = {}): Promise<{
  direction: MoodDirection;
  source: 'ai' | 'rule_engine';
  model: string;
}> {
  const fallback = (): MoodDirection => {
    const rule = MOOD_RULES.find((r) => r.match.test(mood));
    const d = rule?.direction ?? {
      color: 'balanced neutral palette with one accent',
      motion: 'smooth, moderate transitions',
      music: 'light ambient bed under the edit',
      typography: 'clean sans-serif, minimal captions',
      pacing: 'medium pace with an early hook',
      story: 'problem → solution',
    };
    return {
      mood,
      ...d,
      summary: `"${mood}" → ${d.color}; ${d.pacing}.`,
    };
  };

  const out = await aiJson<MoodDirection>({
    system: `You are ReadyForge's Mood-to-Style Translator.
Convert a mood phrase into concrete creative directions.
Return JSON with keys: mood, color, motion, music, typography, pacing, story, summary.
Keep each value short and actionable (max 120 chars). Do not invent brand claims.`,
    user: JSON.stringify({ mood, platform: opts.platform ?? null }),
    fallback,
  });

  const direction = out.data && out.data.color ? out.data : fallback();
  if (opts.platform) direction.summary = `${direction.summary} Tuned for ${opts.platform}.`;
  return { direction, source: out.source, model: out.model };
}

/* ------------------------------------------------------------------ *
 * Taste Conflict Detector (#14)
 * ------------------------------------------------------------------ */

export interface TasteConflict {
  kind: 'taste_vs_audience' | 'taste_vs_platform' | 'taste_vs_tone' | 'taste_vs_goal' | 'taste_vs_budget';
  severity: 'low' | 'medium' | 'high';
  message: string;
  tasteSays: string;
  projectSays: string;
  options: string[];
}

/**
 * Compares the Taste Profile against a project's Intent Lock fields
 * (audience, tone, platform, objective) — the same conflict categories the
 * Consensus engine uses, but for personal taste vs project reality.
 */
export function detectTasteConflicts(profile: ITasteProfile, project: {
  audience?: string;
  tone?: string;
  objective?: string;
  projectType?: string;
  budget?: { amount?: number };
}): TasteConflict[] {
  const conflicts: TasteConflict[] = [];
  const dna = profile.dna;
  const audienceText = `${project.audience ?? ''} ${project.objective ?? ''}`.toLowerCase();

  const tastePacing = String((dna.rhythm as { hookSpeed?: string }).hookSpeed ?? '');
  const fastAudience = /gen ?z|teen|youth|reel|tiktok|short-?form/.test(audienceText);
  if (tastePacing === 'slow' && fastAudience) {
    conflicts.push({
      kind: 'taste_vs_audience',
      severity: 'medium',
      message: 'Your taste leans calm/slow, but this audience expects a fast hook.',
      tasteSays: 'Calm premium pacing, slow zooms and soft fades.',
      projectSays: `Audience "${project.audience ?? 'short-form viewers'}" responds to fast hooks.`,
      options: ['Follow audience/platform need', 'Follow personal taste', 'Create two variants'],
    });
  }

  const tasteTone = String((dna.brand as { tone?: string }).tone ?? (dna.visual as { mood?: string }).mood ?? '').toLowerCase();
  const projectTone = (project.tone ?? '').toLowerCase();
  if (tasteTone && projectTone && !projectTone.includes(tasteTone) && !tasteTone.includes(projectTone)) {
    const tasteEnergy = String((dna.motion as { energy?: string }).energy ?? '');
    if (projectTone.includes('urgent') && tasteEnergy === 'calm') {
      conflicts.push({
        kind: 'taste_vs_tone',
        severity: 'medium',
        message: 'Project tone is urgent but your taste prefers calm motion.',
        tasteSays: 'Calm, elegant, slow reveals.',
        projectSays: `Contract tone: ${project.tone}`,
        options: ['Follow project tone', 'Keep personal taste', 'Create two variants'],
      });
    }
  }

  const platform = String((dna.audience as { platform?: string }).platform ?? '').toLowerCase();
  const aspect = Array.isArray((dna.visual as { aspectRatios?: string[] }).aspectRatios)
    ? ((dna.visual as { aspectRatios?: string[] }).aspectRatios as string[])
    : [];
  if (project.projectType === 'video' && aspect.length && !aspect.some((a) => a.includes('9:16')) && /reel|short|vertical/i.test(audienceText)) {
    conflicts.push({
      kind: 'taste_vs_platform',
      severity: 'low',
      message: 'Your preferred aspect ratio does not match the target placement.',
      tasteSays: `Preferred formats: ${aspect.join(', ')} (favourite platform: ${platform || 'not set'}).`,
      projectSays: 'Target placement is vertical 9:16 short-form.',
      options: ['Adapt format for placement', 'Keep preferred format', 'Produce both'],
    });
  }

  const costSensitivity = String((dna.model as { costSensitivity?: string }).costSensitivity ?? '');
  if (costSensitivity === 'low' && project.budget?.amount === 0) {
    conflicts.push({
      kind: 'taste_vs_budget',
      severity: 'low',
      message: 'You prefer quality over cost, but this project has no budget set.',
      tasteSays: 'Quality-first model choices.',
      projectSays: 'No budget configured for the project.',
      options: ['Set a budget', 'Use cost-aware defaults'],
    });
  }

  return conflicts;
}

/* ------------------------------------------------------------------ *
 * Mood Board Generator (#21)
 * ------------------------------------------------------------------ */

export interface MoodBoard {
  palette: string[];
  typography: string;
  motion: string;
  music: string;
  visualReferences: string[];
  storyboardFrames: Array<{ title: string; description: string }>;
  summary: string;
}

export async function generateMoodBoard(
  brief: string,
  profile: ITasteProfile | null
): Promise<{ board: MoodBoard; source: 'ai' | 'rule_engine'; model: string }> {
  const taste = profile
    ? {
        palette: (profile.dna.visual as { palette?: string[] }).palette ?? [],
        style: (profile.dna.visual as { style?: string[] }).style ?? [],
        camera: (profile.dna.motion as { camera?: string[] }).camera ?? [],
        music: (profile.dna.sound as { genres?: string[] }).genres ?? [],
        fontStyle: (profile.dna.typography as { fontStyle?: string }).fontStyle ?? '',
      }
    : null;

  const fallback = (): MoodBoard => {
    const palette =
      taste?.palette.length
        ? taste.palette
        : ['warm cream', 'charcoal', 'one saturated accent'];
    return {
      palette,
      typography: taste?.fontStyle || 'clean sans-serif, one display weight for headlines',
      motion: taste?.camera.length ? taste.camera.join(', ') : 'slow zoom-ins with soft fades',
      music: taste?.music.length ? taste.music.join(', ') : 'light ambient bed, mood-matched',
      visualReferences: [
        `${taste?.style?.length ? taste.style.join(' + ') : 'minimal'} composition with generous negative space`,
        'reference: product-in-context hero shot, natural light',
        'reference: text-safe zones for captions on the lower third',
      ],
      storyboardFrames: [
        { title: 'Frame 1 — Hook', description: 'First 2 seconds: strongest visual + headline claim.' },
        { title: 'Frame 2 — Problem', description: 'Establish the tension the audience feels.' },
        { title: 'Frame 3 — Solution', description: 'Product/idea as the answer, clearly framed.' },
        { title: 'Frame 4 — Proof', description: 'Approved fact or demo moment.' },
        { title: 'Frame 5 — CTA', description: 'Single call to action, clean end card.' },
      ],
      summary: `Mood board for "${brief.slice(0, 80)}" using ${palette.slice(0, 3).join(', ')}.`,
    };
  };

  const out = await aiJson<MoodBoard>({
    system: `You are ReadyForge's Mood Board Generator.
From a brief (and optionally the creator's Taste Profile) return JSON with keys:
palette (array of 4-5 colour names), typography (string), motion (string), music (string),
visualReferences (array of 3-4 strings), storyboardFrames (array of 5 {title, description}),
summary (string). Never invent facts or brand claims.`,
    user: JSON.stringify({ brief, taste }),
    fallback,
  });

  const board = out.data?.palette?.length ? out.data : fallback();
  return { board, source: out.source, model: out.model };
}

/* ------------------------------------------------------------------ *
 * Creative-block breaker (#30)
 * ------------------------------------------------------------------ */

export interface DirectionSuggestion {
  title: string;
  why: string;
  direction: string;
}

export async function creativeBreaker(
  profile: ITasteProfile | null,
  context: { stuckOn: string; projectId?: string }
): Promise<{ suggestions: DirectionSuggestion[]; source: 'ai' | 'rule_engine'; model: string }> {
  const taste = profile
    ? {
        visual: profile.dna.visual,
        motion: profile.dna.motion,
        story: profile.dna.story,
        adherence: profile.adherence as TasteAdherence,
        exploration: profile.explorationMode as ExplorationMode,
      }
    : null;

  const fallback = (): DirectionSuggestion[] => [
    {
      title: 'Flip the opening',
      why: 'Most stuck drafts share one opening shape.',
      direction: `Start on the result instead of the setup — ${context.stuckOn} tends to open with context.`,
    },
    {
      title: 'Change the pacing',
      why: 'A pacing shift is the cheapest meaningful variation.',
      direction: 'Try the opposite of your usual cut frequency for one pass, then compare.',
    },
    {
      title: 'Borrow across formats',
      why: 'Cross-format mixing breaks repetitive patterns while keeping taste.',
      direction: 'Take the structure of a format you never use (demo → testimonial → tutorial) and re-run the hook.',
    },
    {
      title: 'Constraint sprint',
      why: 'A tight constraint forces new choices.',
      direction: 'Rebuild it with 50% fewer words and one single visual idea.',
    },
  ];

  const out = await aiJson<DirectionSuggestion[]>({
    system: `You are ReadyForge's creative-block breaker.
Return a JSON ARRAY of exactly 4 {title, why, direction} suggestions that give a stuck creator new directions.
Blend the user's taste with deliberate novelty (their exploration mode indicates how far to stray).
Do not invent facts, prices or claims.`,
    user: JSON.stringify({ stuckOn: context.stuckOn, taste }),
    fallback,
  });

  const suggestions = Array.isArray(out.data) && out.data.length ? out.data.slice(0, 4) : fallback();
  return { suggestions, source: out.source, model: out.model };
}

/* ------------------------------------------------------------------ *
 * Taste Confidence Score (#15)
 * ------------------------------------------------------------------ */

/**
 * 0–100. Rises with accepted outputs, manual edits and populated categories;
 * falls with rejections and an empty profile. Low confidence should make the
 * product ask more questions; high confidence pre-fills more aggressively.
 */
export function computeConfidence(profile: ITasteProfile): {
  score: number;
  reason: string;
  basis: { acceptedOutputs: number; edits: number; rejections: number; populatedCategories: number };
} {
  const { acceptedOutputs, edits, rejections } = profile.stats;
  // `profile.dna` is a live Mongoose subdocument — enumerate its plain form,
  // not its prototype-owned members, or populated categories read as empty.
  const dnaObj = (
    typeof (profile.dna as unknown as { toObject?: unknown }).toObject === 'function'
      ? (profile.dna as unknown as { toObject: () => Record<string, unknown> }).toObject()
      : ({ ...(profile.dna as Record<string, unknown>) } as Record<string, unknown>)
  ) as Record<string, Record<string, unknown>>;
  const categories = Object.values(dnaObj);
  const populatedCategories = categories.filter((c) =>
    Object.values(c ?? {}).some((v) => (Array.isArray(v) ? v.length > 0 : v !== undefined && v !== null && v !== ''))
  ).length;

  const evidence = Math.min(60, acceptedOutputs * 6 + edits * 3);
  const structure = Math.round((populatedCategories / 10) * 40);
  const penalty = Math.min(30, rejections * 5);
  const score = Math.max(0, Math.min(100, evidence + structure - penalty));

  const reason =
    score >= 75
      ? 'Strong evidence — pre-fill aggressively.'
      : score >= 40
        ? 'Moderate evidence — pre-fill with confirmations.'
        : 'Low evidence — ask more questions before pre-filling.';

  return {
    score,
    reason,
    basis: { acceptedOutputs, edits, rejections, populatedCategories },
  };
}

/* ------------------------------------------------------------------ *
 * Personalised question flow (#20)
 * ------------------------------------------------------------------ */

/**
 * Maps Workflow DNA + confidence to a question budget:
 * few/balanced/many × confidence. The AI wizard uses this to trim or expand
 * its adaptive question set instead of always asking the same six.
 */
export function adaptiveQuestionCount(
  profile: ITasteProfile | null,
  defaultCount = 6
): { count: number; rationale: string } {
  if (!profile) return { count: defaultCount, rationale: 'No taste profile yet — asking the full set.' };

  const depth = (profile.dna.workflow as { questionDepth?: 'few' | 'balanced' | 'many' }).questionDepth ?? 'balanced';
  const { score } = computeConfidence(profile);

  let multiplier = depth === 'few' ? 0.5 : depth === 'many' ? 1.5 : 1;
  // Low confidence → ask more regardless of preference (the profile is untrusted).
  if (score < 40 && depth !== 'many') multiplier = Math.max(multiplier, 1.25);

  const count = Math.max(2, Math.min(8, Math.round(defaultCount * multiplier)));
  return {
    count,
    rationale:
      `Workflow DNA asks ${depth} questions; taste confidence is ${score}%. ` +
      (score < 40 ? 'Low confidence widens the set.' : 'Confidence allows trimming to preferences.'),
  };
}

/* ------------------------------------------------------------------ *
 * Generation integration — taste direction for prompts (#19, #28)
 * ------------------------------------------------------------------ */

/** Turns a merged DNA into a short prompt block. Empty string when the profile is blank. */
export function describeTasteDirection(
  dna: Record<string, any>,
  adherence: TasteAdherence,
  exploration: ExplorationMode
): string {
  const parts: string[] = [];
  const v = dna.visual ?? {};
  if (v.palette?.length) parts.push(`Colour: ${v.palette.join(', ')}`);
  if (v.mood) parts.push(`Visual mood: ${v.mood}`);
  if (v.lighting) parts.push(`Lighting: ${v.lighting}`);
  if (v.style?.length) parts.push(`Style: ${v.style.join(', ')}`);
  if (v.aspectRatios?.length) parts.push(`Format: ${v.aspectRatios.join(' / ')}`);

  const m = dna.motion ?? {};
  if (m.energy) parts.push(`Motion energy: ${m.energy}`);
  if (m.camera?.length) parts.push(`Camera: ${m.camera.join(', ')}`);
  if (m.transitions?.length) parts.push(`Transitions: ${m.transitions.join(', ')}`);

  const r = dna.rhythm ?? {};
  if (r.hookSpeed) parts.push(`Hook speed: ${r.hookSpeed}`);
  if (r.preferredLength) parts.push(`Preferred length: ${r.preferredLength}`);
  if (r.energyCurve) parts.push(`Energy curve: ${r.energyCurve}`);

  const s = dna.sound ?? {};
  if (s.genres?.length) parts.push(`Music: ${s.genres.join(', ')}`);
  if (s.voiceStyle) parts.push(`Voiceover: ${s.voiceStyle}`);

  const t = dna.typography ?? {};
  if (t.fontStyle) parts.push(`Typography: ${t.fontStyle}`);
  if (t.captionStyle) parts.push(`Captions: ${t.captionStyle}`);

  const st = dna.story ?? {};
  if (st.structure?.length) parts.push(`Story: ${st.structure.join(' → ')}`);
  if (st.narrativeStyle) parts.push(`Narrative: ${st.narrativeStyle}`);
  if (st.humor && st.humor !== 'none') parts.push(`Humour: ${st.humor}`);

  if (!parts.length) return '';
  parts.push(
    adherence === 'high'
      ? 'Adherence: high — follow this direction closely.'
      : adherence === 'low'
        ? 'Adherence: low — stay mostly neutral; use this only as a light touch.'
        : 'Adherence: medium — blend this direction with contract defaults.'
  );
  if (exploration === 'new') parts.push('Exploration mode: new — deliberately step outside this profile.');
  if (exploration === 'mix') parts.push('Exploration mode: mix — blend this profile with one new direction.');
  return parts.join('\n');
}

/** Loads the merged user+project taste direction for a generation call. Null on any problem. */
export async function loadTasteDirection(
  userId: unknown,
  projectId?: unknown
): Promise<string | null> {
  try {
    const user = await TasteProfile.findOne({ userId, projectId: { $exists: false } });
    if (!user) return null;
    const override = projectId ? await TasteProfile.findOne({ userId, projectId }) : null;
    const dna = mergeDna(user.dna as Record<string, any>, (override?.dna as Record<string, any>) ?? undefined);
    return describeTasteDirection(
      dna,
      override?.adherence ?? user.adherence,
      override?.explorationMode ?? user.explorationMode
    ) || null;
  } catch {
    return null;
  }
}
