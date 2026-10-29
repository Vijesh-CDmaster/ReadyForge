import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { Asset } from '../models/Asset';
import { EditComposition, COMPOSITION_TRACK_TYPES, ICompositionClip } from '../models/EditComposition';
import { asyncHandler, ApiError, validateBody } from '../http';
import { AuthedRequest, requireAuth, requireProject, requireRole } from '../middleware/auth';

const clipSchema = z.object({
  assetId: z.string().refine(isValidObjectId, 'must be a valid asset id'),
  trackId: z.string().trim().min(1).max(80),
  trackType: z.enum(COMPOSITION_TRACK_TYPES),
  timelineStartSeconds: z.number().finite().min(0),
  sourceInSeconds: z.number().finite().min(0),
  sourceOutSeconds: z.number().finite().min(0),
});

const saveSchema = z.object({
  schemaVersion: z.number().int().min(1).max(1),
  clips: z.array(clipSchema).max(500),
});

function serializeClip(clip: ICompositionClip & { _id?: Types.ObjectId }) {
  return {
    id: clip._id?.toString(),
    assetId: clip.assetId.toString(),
    trackId: clip.trackId,
    trackType: clip.trackType,
    timelineStartSeconds: clip.timelineStartSeconds,
    sourceInSeconds: clip.sourceInSeconds,
    sourceOutSeconds: clip.sourceOutSeconds,
    durationSeconds: clip.durationSeconds ?? null,
  };
}

function serialize(composition: { _id: Types.ObjectId; projectId: Types.ObjectId; schemaVersion: number; clips: ICompositionClip[]; updatedAt: Date; __v?: number }) {
  return {
    id: composition._id.toString(),
    projectId: composition.projectId.toString(),
    schemaVersion: composition.schemaVersion,
    revision: composition.__v ?? 0,
    clips: composition.clips.map((clip) => serializeClip(clip)),
    updatedAt: composition.updatedAt,
  };
}

export const compositionsRouter = Router();
compositionsRouter.use(requireAuth);

compositionsRouter.get(
  '/projects/:id/composition',
  requireProject(),
  asyncHandler(async (req: AuthedRequest, res) => {
    const composition = await EditComposition.findOne({ projectId: req.project!._id });
    if (!composition) {
      return res.json({
        composition: {
          id: null,
          projectId: req.project!._id.toString(),
          schemaVersion: 1,
          revision: 0,
          clips: [],
          updatedAt: null,
        },
      });
    }
    return res.json({ composition: serialize(composition) });
  })
);

compositionsRouter.put(
  '/projects/:id/composition',
  requireProject('owner', 'lead', 'designer'),
  requireRole('owner', 'lead', 'designer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(saveSchema, req.body);
    const expectedRevisionHeader = req.header('if-match');
    const expectedRevision = expectedRevisionHeader === undefined ? undefined : Number(expectedRevisionHeader);
    if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) {
      throw new ApiError(400, 'If-Match must be a non-negative composition revision.');
    }

    const assetIds = [...new Set(body.clips.map((clip) => clip.assetId))];
    const assets = await Asset.find({
      _id: { $in: assetIds },
      projectId: req.project!._id,
      workspaceId: req.workspace!._id,
      type: { $in: ['video', 'audio'] },
    });
    if (assets.length !== assetIds.length) {
      throw new ApiError(400, 'Every clip must reference an eligible media asset from this project.');
    }

    const byId = new Map(assets.map((asset) => [asset._id.toString(), asset]));
    const clips: ICompositionClip[] = body.clips.map((clip) => {
      const asset = byId.get(clip.assetId);
      if (!asset) throw new ApiError(400, 'Referenced asset is unavailable.');
      const sourceDuration = asset.sourceDurationSeconds;
      if (clip.sourceOutSeconds > 0 && sourceDuration === undefined) {
        throw new ApiError(409, `Duration metadata is unavailable for "${asset.name}"; trimming this asset is disabled.`);
      }
      if (sourceDuration !== undefined && clip.sourceOutSeconds > sourceDuration) {
        throw new ApiError(400, `Clip out-point cannot exceed the source duration for "${asset.name}".`);
      }
      if (clip.sourceOutSeconds > 0 && clip.sourceOutSeconds <= clip.sourceInSeconds) {
        throw new ApiError(400, 'Clip out-point must be greater than its in-point.');
      }
      const duration =
        sourceDuration === undefined
          ? undefined
          : (clip.sourceOutSeconds > 0 ? clip.sourceOutSeconds : sourceDuration) - clip.sourceInSeconds;
      if (duration !== undefined && duration <= 0) {
        throw new ApiError(400, 'Clip source range must have a positive duration.');
      }
      return { ...clip, assetId: new Types.ObjectId(clip.assetId), durationSeconds: duration };
    });

    for (let i = 0; i < clips.length; i += 1) {
      for (let j = i + 1; j < clips.length; j += 1) {
        const a = clips[i];
        const b = clips[j];
        if (a.trackId !== b.trackId) continue;
        if (a.durationSeconds === undefined || b.durationSeconds === undefined) {
          throw new ApiError(400, 'Clips with unknown source duration cannot share a track.');
        }
        const aEnd = a.timelineStartSeconds + a.durationSeconds;
        const bEnd = b.timelineStartSeconds + b.durationSeconds;
        if (a.timelineStartSeconds < bEnd && b.timelineStartSeconds < aEnd) {
          throw new ApiError(400, 'Clips on the same track cannot overlap.');
        }
      }
    }

    let composition = await EditComposition.findOne({ projectId: req.project!._id });
    if (!composition) {
      if (expectedRevision !== undefined && expectedRevision !== 0) {
        throw new ApiError(409, 'Composition was modified concurrently — please reload.');
      }
      composition = new EditComposition({
        projectId: req.project!._id,
        workspaceId: req.workspace!._id,
        ownerId: req.user!._id,
        schemaVersion: body.schemaVersion,
        clips,
      });
    } else {
      if (expectedRevision !== undefined && composition.__v !== expectedRevision) {
        throw new ApiError(409, 'Composition was modified concurrently — please reload.');
      }
      composition.schemaVersion = body.schemaVersion;
      composition.clips = clips;
    }
    await composition.save();
    return res.json({ composition: serialize(composition) });
  })
);
