import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { Asset } from '../models/Asset';
import {
  EditComposition,
  COMPOSITION_TRACK_TYPES,
  ICompositionClip,
  ICompositionTrack,
  resolveCompositionTracks,
} from '../models/EditComposition';
import { asyncHandler, ApiError, validateBody } from '../http';
import { AuthedRequest, requireAuth, requireProject, requireRole } from '../middleware/auth';
import { serializeVideoJob, submitRenderJob } from '../services/videoJobs';
import { getVideoRenderingTools } from '../services/ffmpegTools';

const clipSchema = z.object({
  assetId: z.string().refine(isValidObjectId, 'must be a valid asset id'),
  trackId: z.string().trim().min(1).max(80),
  trackType: z.enum(COMPOSITION_TRACK_TYPES),
  timelineStartSeconds: z.number().finite().min(0),
  sourceInSeconds: z.number().finite().min(0),
  sourceOutSeconds: z.number().finite().min(0),
  order: z.number().int().min(0).optional(),
});

const trackSchema = z.object({
  trackId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  type: z.enum(COMPOSITION_TRACK_TYPES),
  order: z.number().int().min(0),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
});

const saveSchema = z
  .object({
    schemaVersion: z.union([z.literal(1), z.literal(2)]),
    tracks: z.array(trackSchema).max(50).optional(),
    clips: z.array(clipSchema).max(500),
  })
  .superRefine((value, ctx) => {
    if (value.schemaVersion === 2 && (!value.tracks || value.tracks.length === 0) && value.clips.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tracks'],
        message: 'A schema v2 composition with clips must declare its tracks.',
      });
    }
  });

function serializeTrack(track: ICompositionTrack) {
  return {
    trackId: track.trackId,
    name: track.name,
    type: track.type,
    order: track.order,
    muted: Boolean(track.muted),
    hidden: Boolean(track.hidden),
    locked: Boolean(track.locked),
  };
}

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
    order: clip.order ?? 0,
  };
}

function serialize(composition: {
  _id: Types.ObjectId;
  projectId: Types.ObjectId;
  schemaVersion: number;
  tracks?: ICompositionTrack[];
  clips: ICompositionClip[];
  updatedAt: Date;
  __v?: number;
}) {
  return {
    id: composition._id.toString(),
    projectId: composition.projectId.toString(),
    schemaVersion: composition.schemaVersion,
    revision: composition.__v ?? 0,
    tracks: resolveCompositionTracks(composition).map(serializeTrack),
    clips: composition.clips.map((clip) => serializeClip(clip)),
    updatedAt: composition.updatedAt,
  };
}

function clipsEqual(a: ICompositionClip, b: ICompositionClip): boolean {
  return (
    a.assetId.toString() === b.assetId.toString() &&
    a.trackId === b.trackId &&
    a.trackType === b.trackType &&
    Math.abs(a.timelineStartSeconds - b.timelineStartSeconds) < 0.001 &&
    Math.abs(a.sourceInSeconds - b.sourceInSeconds) < 0.001 &&
    Math.abs(a.sourceOutSeconds - b.sourceOutSeconds) < 0.001 &&
    Math.abs((a.durationSeconds ?? 0) - (b.durationSeconds ?? 0)) < 0.001 &&
    (a.order ?? 0) === (b.order ?? 0)
  );
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
          schemaVersion: 2,
          revision: 0,
          tracks: [],
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

    let tracks: ICompositionTrack[];
    if (body.tracks && body.tracks.length > 0) {
      tracks = body.tracks.map((track) => ({ ...track, order: track.order }));
      if (new Set(tracks.map((track) => track.trackId)).size !== tracks.length) {
        throw new ApiError(400, 'Track ids must be unique.');
      }
      if (new Set(tracks.map((track) => track.order)).size !== tracks.length) {
        throw new ApiError(400, 'Track order values must be unique.');
      }
    } else {
      try {
        tracks = resolveCompositionTracks({ clips: body.clips });
      } catch (error) {
        throw new ApiError(400, error instanceof Error ? error.message : 'Unable to derive composition tracks.');
      }
    }
    tracks.sort((a, b) => a.order - b.order);
    const trackById = new Map(tracks.map((track) => [track.trackId, track]));

    for (const clip of body.clips) {
      const track = trackById.get(clip.trackId);
      if (!track) throw new ApiError(400, `Clip references undeclared track "${clip.trackId}".`);
      if (track.type !== clip.trackType) {
        throw new ApiError(400, `Clip type does not match track "${track.name}".`);
      }
      if (track.type === 'text') {
        throw new ApiError(400, 'Text and overlay clips are not supported by this renderer yet.');
      }
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
    const clips: ICompositionClip[] = body.clips.map((clip, index) => {
      const asset = byId.get(clip.assetId);
      if (!asset) throw new ApiError(400, 'Referenced asset is unavailable.');
      if (clip.trackType !== asset.type) {
        throw new ApiError(400, `A ${clip.trackType} clip must reference ${clip.trackType} media.`);
      }
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
      return {
        ...clip,
        assetId: new Types.ObjectId(clip.assetId),
        durationSeconds: duration,
        order: clip.order ?? index,
      };
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
    if (composition) {
      if (expectedRevision !== undefined && composition.__v !== expectedRevision) {
        throw new ApiError(409, 'Composition was modified concurrently — please reload.');
      }
      const existingTracks = resolveCompositionTracks(composition);
      for (const locked of existingTracks.filter((track) => track.locked)) {
        const submitted = trackById.get(locked.trackId);
        if (!submitted) throw new ApiError(409, `Track "${locked.name}" is locked and cannot be removed.`);
        // Lock/unlock is allowed for authorized editors; the clips on a locked
        // track must stay untouched in the same request.
        const metadataSame =
          submitted.name === locked.name &&
          submitted.type === locked.type &&
          submitted.order === locked.order &&
          Boolean(submitted.muted) === Boolean(locked.muted) &&
          Boolean(submitted.hidden) === Boolean(locked.hidden);
        if (!metadataSame) {
          throw new ApiError(409, `Track "${locked.name}" is locked; unlock it before changing its settings.`);
        }
        const before = composition.clips.filter((clip) => clip.trackId === locked.trackId);
        const after = clips.filter((clip) => clip.trackId === locked.trackId);
        const unchanged =
          before.length === after.length &&
          before.every((clip) => after.some((candidate) => clipsEqual(clip, candidate)));
        if (!unchanged) {
          throw new ApiError(409, `Track "${locked.name}" is locked; unlock it before editing its clips.`);
        }
      }
    } else if (expectedRevision !== undefined && expectedRevision !== 0) {
      throw new ApiError(409, 'Composition was modified concurrently — please reload.');
    }

    if (!composition) {
      composition = new EditComposition({
        projectId: req.project!._id,
        workspaceId: req.workspace!._id,
        ownerId: req.user!._id,
        schemaVersion: body.schemaVersion,
        tracks,
        clips,
      });
    } else {
      composition.schemaVersion = body.schemaVersion;
      composition.tracks = tracks;
      composition.clips = clips;
    }
    await composition.save();
    return res.json({ composition: serialize(composition) });
  })
);

compositionsRouter.get(
  '/video-render/tools',
  asyncHandler(async (_req: AuthedRequest, res) => {
    const tools = await getVideoRenderingTools();
    res.setHeader('Cache-Control', 'no-store');
    res.json(tools);
  })
);

compositionsRouter.post(
  '/projects/:id/renders',
  requireProject('owner', 'lead', 'designer'),
  requireRole('owner', 'lead', 'designer'),
  asyncHandler(async (req: AuthedRequest, res) => {
    const key = String(req.headers['idempotency-key'] || '').trim();
    if (!key || key.length > 200) throw new ApiError(400, 'A valid Idempotency-Key header is required.');
    const tools = await getVideoRenderingTools();
    if (!tools.available) {
      throw new ApiError(
        501,
        `Video rendering is unavailable. ${tools.message || 'FFmpeg and FFprobe must be configured.'}`
      );
    }
    const composition = await EditComposition.findOne({ projectId: req.project!._id });
    if (!composition) throw new ApiError(409, 'Save a composition before rendering.');
    const result = await submitRenderJob({
      projectId: req.project!._id,
      workspaceId: req.workspace!._id,
      userId: req.user!._id,
      compositionId: composition._id,
      compositionRevision: composition.__v,
      idempotencyKey: key,
    });
    res.status(result.duplicate ? 200 : 202).json({ job: serializeVideoJob(result.task), duplicate: result.duplicate });
  })
);
