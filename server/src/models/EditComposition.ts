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
}

export interface ICompositionClip {
  _id?: Types.ObjectId;
  assetId: Types.ObjectId;
  trackId: string;
  trackType: CompositionTrackType;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds?: number;
  /** Stable position when clips share a timeline start; lower renders first. */
  order?: number;
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
  },
  { _id: false }
);

const clipSchema = new Schema<ICompositionClip>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    trackId: { type: String, required: true, maxlength: 80 },
    trackType: { type: String, enum: COMPOSITION_TRACK_TYPES, required: true },
    timelineStartSeconds: { type: Number, required: true, min: 0 },
    sourceInSeconds: { type: Number, required: true, min: 0 },
    sourceOutSeconds: { type: Number, required: true, min: 0 },
    durationSeconds: { type: Number, min: 0 },
    order: { type: Number, default: 0, min: 0 },
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
