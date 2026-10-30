import { Schema, model, Types } from 'mongoose';

export const COMPOSITION_TRACK_TYPES = ['video', 'audio', 'text'] as const;
export type CompositionTrackType = (typeof COMPOSITION_TRACK_TYPES)[number];

export interface ICompositionTrack {
  trackId: string;
  name: string;
  type: CompositionTrackType;
  order: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
  /** Linear gain applied to every clip on this track (0–2). */
  volume?: number;
}

export const TEXT_ENTRANCE_ANIMATIONS = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'zoom',
  'pop',
] as const;
export type TextEntranceAnimation = (typeof TEXT_ENTRANCE_ANIMATIONS)[number];

export const TEXT_EXIT_ANIMATIONS = [
  'fade',
  'slide-left',
  'slide-right',
  'slide-top',
  'slide-bottom',
  'zoom',
] as const;
export type TextExitAnimation = (typeof TEXT_EXIT_ANIMATIONS)[number];

export const ANIMATION_EASINGS = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;
export type AnimationEasing = (typeof ANIMATION_EASINGS)[number];

export interface ITextAnimationSettings {
  type: string;
  durationSeconds: number;
  delaySeconds: number;
  easing: AnimationEasing;
}

export interface ITextAnimation {
  /** Model version so stored animations stay interpretable. */
  version: 1;
  entrance?: ITextAnimationSettings;
  exit?: ITextAnimationSettings;
}

export const TRANSITION_TYPES = [
  'crossfade',
  'fade-black',
  'fade-white',
  'wipe-left',
  'wipe-right',
  'slide-left',
  'slide-right',
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

/**
 * A transition is declared on the incoming clip and refers to the clip that
 * ends exactly where this one starts on the same track.
 */
export interface ICompositionTransition {
  type: TransitionType;
  durationSeconds: number;
}

export interface IClipAudio {
  /** Linear gain for this clip (0–2). */
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export type TextAlignment = (typeof TEXT_ALIGNMENTS)[number];

export interface ICompositionText {
  content: string;
  /** Normalized horizontal anchor within the frame (0 = left, 1 = right). */
  x: number;
  /** Normalized top edge within the frame. */
  y: number;
  /** Normalized maximum text width. */
  width: number;
  alignment: TextAlignment;
  fontFamily: string;
  fontSize: number;
  fontColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  textOpacity: number;
  bold: boolean;
  italic: boolean;
  shadow: boolean;
  outline: boolean;
  outlineColor: string;
  outlineWidth: number;
  zIndex: number;
  animation?: ITextAnimation;
}

export interface ICompositionClip {
  _id?: Types.ObjectId;
  /** Absent for text/overlay clips. */
  assetId?: Types.ObjectId;
  trackId: string;
  trackType: CompositionTrackType;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds?: number;
  /** Stable position when clips share a timeline start; lower renders first. */
  order?: number;
  text?: ICompositionText;
  transitionIn?: ICompositionTransition;
  audio?: IClipAudio;
}

export interface IEditComposition {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  ownerId: Types.ObjectId;
  schemaVersion: number;
  tracks: ICompositionTrack[];
  clips: ICompositionClip[];
  createdAt: Date;
  updatedAt: Date;
}

const trackSchema = new Schema<ICompositionTrack>(
  {
    trackId: { type: String, required: true, maxlength: 80 },
    name: { type: String, required: true, maxlength: 120 },
    type: { type: String, enum: COMPOSITION_TRACK_TYPES, required: true },
    order: { type: Number, required: true, min: 0 },
    muted: { type: Boolean, default: false },
    hidden: { type: Boolean, default: false },
    locked: { type: Boolean, default: false },
    volume: { type: Number, default: 1, min: 0, max: 2 },
  },
  { _id: false }
);

const animationSettingsSchema = new Schema<ITextAnimationSettings>(
  {
    type: { type: String, required: true, maxlength: 40 },
    durationSeconds: { type: Number, required: true, min: 0.05, max: 10 },
    delaySeconds: { type: Number, default: 0, min: 0, max: 10 },
    easing: { type: String, enum: ANIMATION_EASINGS, default: 'ease-out' },
  },
  { _id: false }
);

const animationSchema = new Schema<ITextAnimation>(
  {
    version: { type: Number, required: true, min: 1, max: 1, default: 1 },
    entrance: { type: animationSettingsSchema },
    exit: { type: animationSettingsSchema },
  },
  { _id: false }
);

const transitionSchema = new Schema<ICompositionTransition>(
  {
    type: { type: String, enum: TRANSITION_TYPES, required: true },
    durationSeconds: { type: Number, required: true, min: 0.1, max: 5 },
  },
  { _id: false }
);

const clipAudioSchema = new Schema<IClipAudio>(
  {
    volume: { type: Number, default: 1, min: 0, max: 2 },
    fadeInSeconds: { type: Number, default: 0, min: 0, max: 30 },
    fadeOutSeconds: { type: Number, default: 0, min: 0, max: 30 },
  },
  { _id: false }
);

const textSchema = new Schema<ICompositionText>(
  {
    content: { type: String, required: true, maxlength: 1000 },
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
    width: { type: Number, required: true, min: 0.05, max: 1 },
    alignment: { type: String, enum: TEXT_ALIGNMENTS, default: 'center' },
    fontFamily: { type: String, required: true, maxlength: 40 },
    fontSize: { type: Number, required: true, min: 8, max: 200 },
    fontColor: { type: String, required: true, maxlength: 7 },
    backgroundColor: { type: String, required: true, maxlength: 7 },
    backgroundOpacity: { type: Number, required: true, min: 0, max: 1 },
    textOpacity: { type: Number, required: true, min: 0, max: 1 },
    bold: { type: Boolean, default: false },
    italic: { type: Boolean, default: false },
    shadow: { type: Boolean, default: false },
    outline: { type: Boolean, default: false },
    outlineColor: { type: String, required: true, maxlength: 7 },
    outlineWidth: { type: Number, required: true, min: 0, max: 10 },
    zIndex: { type: Number, required: true, min: 0, max: 1000 },
    animation: { type: animationSchema },
  },
  { _id: false }
);

const clipSchema = new Schema<ICompositionClip>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset' },
    trackId: { type: String, required: true, maxlength: 80 },
    trackType: { type: String, enum: COMPOSITION_TRACK_TYPES, required: true },
    timelineStartSeconds: { type: Number, required: true, min: 0 },
    sourceInSeconds: { type: Number, required: true, min: 0, default: 0 },
    sourceOutSeconds: { type: Number, required: true, min: 0, default: 0 },
    durationSeconds: { type: Number, min: 0 },
    order: { type: Number, default: 0, min: 0 },
    text: { type: textSchema },
    transitionIn: { type: transitionSchema },
    audio: { type: clipAudioSchema },
  },
  { _id: true }
);

const compositionSchema = new Schema<IEditComposition>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    schemaVersion: { type: Number, required: true, min: 1, default: 1 },
    tracks: { type: [trackSchema], default: [] },
    clips: { type: [clipSchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

/**
 * Old compositions only stored clips. Derive the implicit tracks in a stable
 * order (video tracks first, then audio) so existing projects open unchanged.
 */
export function resolveCompositionTracks(composition: {
  tracks?: ICompositionTrack[];
  clips: Array<Pick<ICompositionClip, 'trackId' | 'trackType'>>;
}): ICompositionTrack[] {
  if (composition.tracks && composition.tracks.length > 0) {
    return [...composition.tracks].sort((a, b) => a.order - b.order || a.trackId.localeCompare(b.trackId));
  }
  const seen = new Map<string, CompositionTrackType>();
  for (const clip of composition.clips) {
    const existing = seen.get(clip.trackId);
    if (!existing) seen.set(clip.trackId, clip.trackType);
    else if (existing !== clip.trackType) {
      throw new Error(`Track "${clip.trackId}" mixes clip types.`);
    }
  }
  const entries = [...seen.entries()];
  const rank = { video: 0, audio: 1, text: 2 } as const;
  entries.sort((a, b) => rank[a[1]] - rank[b[1]]);
  const counters = { video: 0, audio: 0, text: 0 };
  return entries.map(([trackId, type], index) => {
    counters[type] += 1;
    return {
      trackId,
      name: `${type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Text'} ${counters[type]}`,
      type,
      order: index,
      muted: false,
      hidden: false,
      locked: false,
    };
  });
}

export const EditComposition = model<IEditComposition>('EditComposition', compositionSchema);
