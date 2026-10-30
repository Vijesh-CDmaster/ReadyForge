import { Router } from 'express';
import { isValidObjectId, Types } from 'mongoose';
import { z } from 'zod';
import { Asset } from '../models/Asset';
import {
  EditComposition,
  ANIMATION_EASINGS,
  COMPOSITION_TRACK_TYPES,
  ICompositionClip,
  ICompositionText,
  ICompositionTrack,
  TEXT_ALIGNMENTS,
  TEXT_ENTRANCE_ANIMATIONS,
  TEXT_EXIT_ANIMATIONS,
  TRANSITION_TYPES,
  resolveCompositionTracks,
} from '../models/EditComposition';
import { asyncHandler, ApiError, validateBody } from '../http';
import { AuthedRequest, requireAuth, requireProject, requireRole } from '../middleware/auth';
import { serializeVideoJob, submitRenderJob } from '../services/videoJobs';
import { getVideoRenderingTools } from '../services/ffmpegTools';
import { APPROVED_FONT_FAMILIES, stripControlCharacters } from '../services/textOverlay';
import { parseSrt, SrtParseError } from '../services/srt';

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const hexColor = z.string().regex(HEX_COLOR, 'must be a #RRGGBB colour');

const textSchema = z.object({
  content: z
    .string()
    .transform((value) => stripControlCharacters(value.replace(/\r\n?/g, '\n')))
    .pipe(z.string().trim().min(1, 'Text content is required').max(1000)),
  x: z.number().finite().min(0).max(1),
  y: z.number().finite().min(0).max(1),
  width: z.number().finite().min(0.05).max(1),
  alignment: z.enum(TEXT_ALIGNMENTS),
  fontFamily: z.enum(APPROVED_FONT_FAMILIES),
  fontSize: z.number().finite().min(8).max(200),
  fontColor: hexColor,
  backgroundColor: hexColor,
  backgroundOpacity: z.number().finite().min(0).max(1),
  textOpacity: z.number().finite().min(0).max(1),
  bold: z.boolean().default(false),
  italic: z.boolean().default(false),
  shadow: z.boolean().default(false),
  outline: z.boolean().default(false),
  outlineColor: hexColor.default('#000000'),
  outlineWidth: z.number().finite().min(0).max(10).default(2),
  zIndex: z.number().int().min(0).max(1000).default(0),
  animation: z
    .object({
      version: z.literal(1),
      entrance: z
        .object({
          type: z.enum(TEXT_ENTRANCE_ANIMATIONS),
          durationSeconds: z.number().finite().min(0.05).max(10),
          delaySeconds: z.number().finite().min(0).max(10).default(0),
          easing: z.enum(ANIMATION_EASINGS).default('ease-out'),
        })
        .nullish(),
      exit: z
        .object({
          type: z.enum(TEXT_EXIT_ANIMATIONS),
          durationSeconds: z.number().finite().min(0.05).max(10),
          delaySeconds: z.number().finite().min(0).max(10).default(0),
          easing: z.enum(ANIMATION_EASINGS).default('ease-out'),
        })
        .nullish(),
    })
    .nullish(),
});

const transitionSchema = z.object({
  type: z.enum(TRANSITION_TYPES),
  durationSeconds: z.number().finite().min(0.1).max(5),
});

const clipAudioSchema = z.object({
  volume: z.number().finite().min(0).max(2).default(1),
  fadeInSeconds: z.number().finite().min(0).max(30).default(0),
  fadeOutSeconds: z.number().finite().min(0).max(30).default(0),
});

const clipSchema = z.object({
  assetId: z.string().refine(isValidObjectId, 'must be a valid asset id').optional(),
  trackId: z.string().trim().min(1).max(80),
  trackType: z.enum(COMPOSITION_TRACK_TYPES),
  timelineStartSeconds: z.number().finite().min(0),
  sourceInSeconds: z.number().finite().min(0).default(0),
  sourceOutSeconds: z.number().finite().min(0).default(0),
  durationSeconds: z.number().finite().min(0.1).max(3600).optional(),
  order: z.number().int().min(0).optional(),
  text: textSchema.optional(),
  transitionIn: transitionSchema.optional(),
  audio: clipAudioSchema.optional(),
});

const trackSchema = z.object({
  trackId: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(120),
  type: z.enum(COMPOSITION_TRACK_TYPES),
  order: z.number().int().min(0),
  muted: z.boolean().default(false),
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  volume: z.number().finite().min(0).max(2).default(1),
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
    volume: track.volume ?? 1,
  };
}

function serializeText(text: ICompositionText) {
  return {
    content: text.content,
    x: text.x,
    y: text.y,
    width: text.width,
    alignment: text.alignment,
    fontFamily: text.fontFamily,
    fontSize: text.fontSize,
    fontColor: text.fontColor,
    backgroundColor: text.backgroundColor,
    backgroundOpacity: text.backgroundOpacity,
    textOpacity: text.textOpacity,
    bold: Boolean(text.bold),
    italic: Boolean(text.italic),
    shadow: Boolean(text.shadow),
    outline: Boolean(text.outline),
    outlineColor: text.outlineColor,
    outlineWidth: text.outlineWidth,
    zIndex: text.zIndex,
    animation: text.animation
      ? {
          version: 1 as const,
          entrance: text.animation.entrance
            ? {
                type: text.animation.entrance.type,
                durationSeconds: text.animation.entrance.durationSeconds,
                delaySeconds: text.animation.entrance.delaySeconds ?? 0,
                easing: text.animation.entrance.easing,
              }
            : null,
          exit: text.animation.exit
            ? {
                type: text.animation.exit.type,
                durationSeconds: text.animation.exit.durationSeconds,
                delaySeconds: text.animation.exit.delaySeconds ?? 0,
                easing: text.animation.exit.easing,
              }
            : null,
        }
      : null,
  };
}

function serializeClip(clip: ICompositionClip & { _id?: Types.ObjectId }) {
  return {
    id: clip._id?.toString(),
    assetId: clip.assetId ? clip.assetId.toString() : null,
    trackId: clip.trackId,
    trackType: clip.trackType,
    timelineStartSeconds: clip.timelineStartSeconds,
    sourceInSeconds: clip.sourceInSeconds,
    sourceOutSeconds: clip.sourceOutSeconds,
    durationSeconds: clip.durationSeconds ?? null,
    order: clip.order ?? 0,
    text: clip.text ? serializeText(clip.text) : null,
    transitionIn: clip.transitionIn
      ? { type: clip.transitionIn.type, durationSeconds: clip.transitionIn.durationSeconds }
      : null,
    audio: clip.audio
      ? {
          volume: clip.audio.volume ?? 1,
          fadeInSeconds: clip.audio.fadeInSeconds ?? 0,
          fadeOutSeconds: clip.audio.fadeOutSeconds ?? 0,
        }
      : null,
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
    (a.assetId?.toString() ?? '') === (b.assetId?.toString() ?? '') &&
    a.trackId === b.trackId &&
    a.trackType === b.trackType &&
    Math.abs(a.timelineStartSeconds - b.timelineStartSeconds) < 0.001 &&
    Math.abs(a.sourceInSeconds - b.sourceInSeconds) < 0.001 &&
    Math.abs(a.sourceOutSeconds - b.sourceOutSeconds) < 0.001 &&
    Math.abs((a.durationSeconds ?? 0) - (b.durationSeconds ?? 0)) < 0.001 &&
    (a.order ?? 0) === (b.order ?? 0) &&
    JSON.stringify(a.text ? serializeText(a.text) : null) === JSON.stringify(b.text ? serializeText(b.text) : null) &&
    JSON.stringify(a.transitionIn ?? null) === JSON.stringify(b.transitionIn ?? null) &&
    JSON.stringify(a.audio ?? null) === JSON.stringify(b.audio ?? null)
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
      if (clip.transitionIn && track.type !== 'video') {
        throw new ApiError(400, 'Transitions are only supported between video clips.');
      }
      if (clip.audio && track.type !== 'audio') {
        throw new ApiError(400, 'Clip volume and fades are only supported on audio clips.');
      }
      if (track.type !== 'audio' && track.volume !== undefined && track.volume !== 1) {
        throw new ApiError(400, `Track "${track.name}" is not an audio track; it has no volume.`);
      }
      if (track.type === 'text') {
        if (clip.assetId) throw new ApiError(400, 'Text clips cannot reference media assets.');
        if (!clip.text) throw new ApiError(400, 'Every text clip must include its text properties.');
        if (clip.durationSeconds === undefined) {
          throw new ApiError(400, 'Every text clip must include a positive timeline duration.');
        }
        for (const [slot, settings] of [
          ['entrance', clip.text.animation?.entrance],
          ['exit', clip.text.animation?.exit],
        ] as const) {
          if (!settings) continue;
          const span = settings.durationSeconds + (settings.delaySeconds ?? 0);
          if (span > clip.durationSeconds + 0.001) {
            throw new ApiError(
              400,
              `The ${slot} animation (delay + duration ${span.toFixed(2)}s) does not fit inside a ${clip.durationSeconds.toFixed(2)}s text clip.`
            );
          }
        }
      } else {
        if (!clip.assetId) throw new ApiError(400, 'Media clips must reference an asset.');
        if (clip.text) throw new ApiError(400, 'Only clips on text tracks may include text properties.');
      }
    }

    const assetIds = [
      ...new Set(
        body.clips
          .filter((clip) => clip.trackType !== 'text')
          .map((clip) => clip.assetId)
          .filter((value): value is string => Boolean(value))
      ),
    ];
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
      if (clip.trackType === 'text') {
        return {
          trackId: clip.trackId,
          trackType: 'text',
          timelineStartSeconds: clip.timelineStartSeconds,
          sourceInSeconds: 0,
          sourceOutSeconds: 0,
          durationSeconds: clip.durationSeconds,
          order: clip.order ?? index,
          text: clip.text as ICompositionText,
        };
      }
      const asset = byId.get(clip.assetId!);
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
        trackId: clip.trackId,
        trackType: clip.trackType,
        timelineStartSeconds: clip.timelineStartSeconds,
        sourceInSeconds: clip.sourceInSeconds,
        sourceOutSeconds: clip.sourceOutSeconds,
        assetId: new Types.ObjectId(clip.assetId),
        durationSeconds: duration,
        order: clip.order ?? index,
        transitionIn: clip.transitionIn,
        audio: clip.audio,
      };
    });

    for (let i = 0; i < clips.length; i += 1) {
      for (let j = i + 1; j < clips.length; j += 1) {
        const a = clips[i];
        const b = clips[j];
        if (a.trackId !== b.trackId) continue;
        // Text overlays may overlap in time; z-index and draw order decide stacking.
        if (trackById.get(a.trackId)?.type === 'text') continue;
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

    for (const clip of clips) {
      if (clip.audio) {
        const duration = clip.durationSeconds ?? 0;
        if (clip.audio.fadeInSeconds + clip.audio.fadeOutSeconds > duration + 0.001) {
          throw new ApiError(400, 'Audio fades must fit inside the clip duration.');
        }
      }
      if (!clip.transitionIn) continue;
      const predecessors = clips
        .filter((candidate) => candidate !== clip && candidate.trackId === clip.trackId)
        .filter((candidate) => {
          const end = candidate.timelineStartSeconds + (candidate.durationSeconds ?? 0);
          return Math.abs(end - clip.timelineStartSeconds) <= 0.011;
        });
      if (predecessors.length !== 1) {
        throw new ApiError(
          400,
          'A transition needs exactly one earlier clip on the same track that ends where this clip starts.'
        );
      }
      const previous = predecessors[0];
      const limit = Math.min(previous.durationSeconds ?? 0, clip.durationSeconds ?? 0);
      if (clip.transitionIn.durationSeconds > limit + 0.001) {
        throw new ApiError(
          400,
          `A ${clip.transitionIn.durationSeconds.toFixed(2)}s transition does not fit inside the ${limit.toFixed(2)}s shorter clip.`
        );
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
          Boolean(submitted.hidden) === Boolean(locked.hidden) &&
          (submitted.volume ?? 1) === (locked.volume ?? 1);
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

const subtitleSchema = z.object({ srt: z.string().min(1).max(200_000) });

compositionsRouter.post(
  '/subtitles/parse',
  asyncHandler(async (req: AuthedRequest, res) => {
    const body = validateBody(subtitleSchema, req.body);
    try {
      const cues = parseSrt(body.srt);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ cues, count: cues.length });
    } catch (error) {
      if (error instanceof SrtParseError) throw new ApiError(400, error.message);
      throw error;
    }
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
