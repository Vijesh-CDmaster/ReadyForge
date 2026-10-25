import { Schema, model, Types } from 'mongoose';

/** The ten groups of the Creative Taste DNA. */
export const TASTE_CATEGORIES = [
  'visual',
  'motion',
  'rhythm',
  'sound',
  'typography',
  'story',
  'audience',
  'workflow',
  'model',
  'brand',
] as const;
export type TasteCategory = (typeof TASTE_CATEGORIES)[number];

export const TASTE_CATEGORY_LABELS: Record<TasteCategory, string> = {
  visual: 'Visual DNA',
  motion: 'Motion DNA',
  rhythm: 'Rhythm DNA',
  sound: 'Sound DNA',
  typography: 'Typography DNA',
  story: 'Story DNA',
  audience: 'Audience DNA',
  workflow: 'Workflow DNA',
  model: 'Model DNA',
  brand: 'Brand DNA',
};

/** Taste Slider: how strongly generation follows the profile. */
export const ADHERENCE_LEVELS = ['low', 'medium', 'high'] as const;
export type TasteAdherence = (typeof ADHERENCE_LEVELS)[number];

/** Style Exploration Mode (#22): stay close, go new, or mix. */
export const EXPLORATION_MODES = ['new', 'close', 'mix'] as const;
export type ExplorationMode = (typeof EXPLORATION_MODES)[number];

export type TasteSource = 'manual' | 'learned' | 'preset' | 'mood' | 'onboarding';

const noId = { _id: false } as const;

const visualSchema = new Schema(
  {
    palette: [String],
    mood: String,
    contrast: String,
    lighting: String,
    texture: String,
    style: [String],
    imagery: [String],
    composition: String,
    aspectRatios: [String],
  },
  noId
);

const motionSchema = new Schema(
  {
    animationStyle: [String],
    energy: String,
    camera: [String],
    transitions: [String],
    objects: [String],
    intensity: String,
  },
  noId
);

const rhythmSchema = new Schema(
  {
    sceneDuration: String,
    cutFrequency: String,
    hookSpeed: String,
    energyCurve: String,
    preferredLength: String,
    platformPacing: [String],
  },
  noId
);

const soundSchema = new Schema(
  {
    genres: [String],
    mood: String,
    tempo: String,
    voiceStyle: String,
    voiceAccent: String,
    musicVolume: String,
    sfx: String,
    sync: String,
  },
  noId
);

const typographySchema = new Schema(
  {
    fontStyle: String,
    placement: String,
    textAnimation: [String],
    captionStyle: String,
    languageTone: String,
  },
  noId
);

const storySchema = new Schema(
  {
    structure: [String],
    emotionalArc: [String],
    narrativeStyle: String,
    humor: String,
    exampleTypes: [String],
  },
  noId
);

const audienceSchema = new Schema(
  {
    ageGroup: String,
    mood: String,
    culturalContext: String,
    platform: String,
    attentionSpan: String,
    format: String,
    languageStyle: String,
  },
  noId
);

const workflowSchema = new Schema(
  {
    questionDepth: { type: String, enum: ['few', 'balanced', 'many'], default: 'balanced' },
    editingMode: { type: String, enum: ['manual', 'assisted', 'auto'], default: 'assisted' },
    approvalStyle: { type: String, enum: ['step', 'fast'], default: 'step' },
    explanation: { type: String, enum: ['short', 'detailed'], default: 'short' },
    suggestions: { type: Boolean, default: true },
    riskiness: { type: String, enum: ['conservative', 'balanced', 'bold'], default: 'balanced' },
    previewFirst: { type: Boolean, default: true },
    notifications: { type: String, enum: ['immediate', 'digest'], default: 'immediate' },
  },
  noId
);

const modelSchema = new Schema(
  {
    preferredModels: [String],
    costSensitivity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    qualityPreference: { type: String, enum: ['fast', 'balanced', 'best'], default: 'balanced' },
  },
  noId
);

const brandSchema = new Schema(
  {
    colors: [String],
    tone: String,
    terminology: [String],
    bannedWords: [String],
    rules: [String],
    restrictions: [String],
  },
  noId
);

const dnaSchema = new Schema(
  {
    visual: { type: visualSchema, default: () => ({}) },
    motion: { type: motionSchema, default: () => ({}) },
    rhythm: { type: rhythmSchema, default: () => ({}) },
    sound: { type: soundSchema, default: () => ({}) },
    typography: { type: typographySchema, default: () => ({}) },
    story: { type: storySchema, default: () => ({}) },
    audience: { type: audienceSchema, default: () => ({}) },
    workflow: { type: workflowSchema, default: () => ({}) },
    model: { type: modelSchema, default: () => ({}) },
    brand: { type: brandSchema, default: () => ({}) },
  },
  noId
);

export type TasteDna = {
  visual: Record<string, unknown>;
  motion: Record<string, unknown>;
  rhythm: Record<string, unknown>;
  sound: Record<string, unknown>;
  typography: Record<string, unknown>;
  story: Record<string, unknown>;
  audience: Record<string, unknown>;
  workflow: Record<string, unknown>;
  model: Record<string, unknown>;
  brand: Record<string, unknown>;
};

const historySchema = new Schema(
  {
    at: { type: Date, required: true },
    category: { type: String, enum: TASTE_CATEGORIES },
    summary: { type: String, required: true, maxlength: 400 },
    source: {
      type: String,
      enum: ['manual', 'learned', 'preset', 'mood', 'onboarding'],
      default: 'manual',
    },
    scope: { type: String, enum: ['user', 'project'], default: 'user' },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project' },
    /** "Remember this choice?" — only persistent preferences are stored. */
    remember: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export interface ITasteHistoryEntry {
  _id?: Types.ObjectId;
  at: Date;
  category?: TasteCategory;
  summary: string;
  source: TasteSource;
  scope: 'user' | 'project';
  projectId?: Types.ObjectId;
  remember: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ITasteProfile {
  _id: Types.ObjectId;
  /** null/undefined = personal (per-user) profile; set = per-project override. */
  userId: Types.ObjectId;
  projectId?: Types.ObjectId;
  dna: TasteDna;
  adherence: TasteAdherence;
  explorationMode: ExplorationMode;
  /** Learning stats behind the Taste Confidence Score. */
  stats: { acceptedOutputs: number; edits: number; rejections: number };
  history: ITasteHistoryEntry[];
  /** Set once the guided mood intake has run (personalised onboarding, #29). */
  onboardedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const tasteProfileSchema = new Schema<ITasteProfile>(
  {
    // Indexed via the two partial unique compound indexes below (plain index: true
    // would duplicate them and make Mongoose warn on every boot).
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', index: true },
    dna: { type: dnaSchema, default: () => ({}) },
    adherence: { type: String, enum: ADHERENCE_LEVELS, default: 'medium' },
    explorationMode: { type: String, enum: EXPLORATION_MODES, default: 'close' },
    stats: {
      acceptedOutputs: { type: Number, default: 0, min: 0 },
      edits: { type: Number, default: 0, min: 0 },
      rejections: { type: Number, default: 0, min: 0 },
    },
    history: { type: [historySchema], default: [] },
    onboardedAt: { type: Date },
  },
  { timestamps: true }
);

// One personal profile per user, one override per user+project.
tasteProfileSchema.index({ userId: 1, projectId: 1 }, { unique: true, partialFilterExpression: { projectId: { $exists: true } } });
tasteProfileSchema.index({ userId: 1 }, { unique: true, partialFilterExpression: { projectId: { $exists: false } } });

export const TasteProfile = model<ITasteProfile>('TasteProfile', tasteProfileSchema);

/**
 * Deep-ish merge: arrays and scalars from `over` win, everything else falls back to `base`.
 *
 * `base` is often a live Mongoose subdocument — spreading one does NOT copy its
 * field values (they live behind prototype getters), which would silently wipe
 * the existing profile on every merge. Convert to a plain object first.
 */
export function mergeDna<T extends Record<string, any>>(base: T, over: Partial<T> | undefined): T {
  const source = base as (Record<string, any> & { toObject?: () => Record<string, any> }) | undefined;
  const baseObj: Record<string, any> =
    source && typeof source.toObject === 'function' ? source.toObject() : { ...(source ?? {}) };
  if (!over) return baseObj as T;
  const out: Record<string, any> = baseObj;
  for (const [key, value] of Object.entries(over)) {
    if (value === undefined || value === null) continue;
    const current = out[key];
    if (Array.isArray(value)) {
      out[key] = value;
    } else if (typeof value === 'object' && current && typeof current === 'object' && !Array.isArray(current)) {
      out[key] = mergeDna(current, value);
    } else {
      out[key] = value;
    }
  }
  return out as T;
}
