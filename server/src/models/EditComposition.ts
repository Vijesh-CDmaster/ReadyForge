import { Schema, model, Types } from 'mongoose';

export const COMPOSITION_TRACK_TYPES = ['video', 'audio'] as const;
export type CompositionTrackType = (typeof COMPOSITION_TRACK_TYPES)[number];

export interface ICompositionClip {
  assetId: Types.ObjectId;
  trackId: string;
  trackType: CompositionTrackType;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds?: number;
}

export interface IEditComposition {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  workspaceId: Types.ObjectId;
  ownerId: Types.ObjectId;
  schemaVersion: number;
  clips: ICompositionClip[];
  createdAt: Date;
  updatedAt: Date;
}

const clipSchema = new Schema<ICompositionClip>(
  {
    assetId: { type: Schema.Types.ObjectId, ref: 'Asset', required: true },
    trackId: { type: String, required: true, maxlength: 80 },
    trackType: { type: String, enum: COMPOSITION_TRACK_TYPES, required: true },
    timelineStartSeconds: { type: Number, required: true, min: 0 },
    sourceInSeconds: { type: Number, required: true, min: 0 },
    sourceOutSeconds: { type: Number, required: true, min: 0 },
    durationSeconds: { type: Number, min: 0 },
  },
  { _id: true }
);

const compositionSchema = new Schema<IEditComposition>(
  {
    projectId: { type: Schema.Types.ObjectId, ref: 'Project', required: true, unique: true, index: true },
    workspaceId: { type: Schema.Types.ObjectId, ref: 'Workspace', required: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    schemaVersion: { type: Number, required: true, min: 1, default: 1 },
    clips: { type: [clipSchema], default: [] },
  },
  { timestamps: true, optimisticConcurrency: true }
);

export const EditComposition = model<IEditComposition>('EditComposition', compositionSchema);
