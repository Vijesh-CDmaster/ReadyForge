import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Eye,
  EyeOff,
  Film,
  Lock,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Trash2,
  Type,
  Undo2,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, ApiRequestError } from '../lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, SectionTitle } from '../components/ui';
import { useProject } from './ProjectLayout';

type TrackType = 'video' | 'audio' | 'text';

interface AssetRow {
  id: string;
  name: string;
  type: 'video' | 'audio' | string;
  fileUrl: string;
  mimeType: string;
  sourceDurationSeconds?: number;
}

interface Track {
  trackId: string;
  name: string;
  type: TrackType;
  order: number;
  muted: boolean;
  hidden: boolean;
  locked: boolean;
}

interface Clip {
  id?: string;
  assetId: string;
  trackId: string;
  trackType: TrackType;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds: number | null;
  order: number;
}

interface Composition {
  id: string | null;
  projectId: string;
  schemaVersion: number;
  revision: number;
  tracks: Track[];
  clips: Clip[];
  updatedAt: string | null;
}

interface RenderJob {
  id: string;
  status: string;
  progress: number;
  currentStage: string;
  outputAssetId: string | null;
  errorMessage: string | null;
}

interface RenderToolStatus {
  available: boolean;
  version: string | null;
  error: string | null;
}

interface RenderTools {
  available: boolean;
  ffmpeg: RenderToolStatus;
  ffprobe: RenderToolStatus;
  missingCodecs: string[];
  message: string | null;
}

const emptyComposition = (projectId: string): Composition => ({
  id: null,
  projectId,
  schemaVersion: 2,
  revision: 0,
  tracks: [],
  clips: [],
  updatedAt: null,
});

const HEADER_WIDTH = 156;

function snap(value: number): number {
  return Math.round(value * 10) / 10;
}

function endOf(clip: Clip): number {
  return clip.timelineStartSeconds + (clip.durationSeconds ?? 0);
}

function clipRangeEnd(clip: Clip): number {
  return clip.sourceOutSeconds > 0 ? clip.sourceOutSeconds : clip.sourceInSeconds + (clip.durationSeconds ?? 0);
}

function durationOf(clip: Clip): number {
  return Math.max(0, clipRangeEnd(clip) - clip.sourceInSeconds);
}

export default function VideoEditor() {
  const { projectId = '' } = useParams();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject();
  const queryClient = useQueryClient();
  const [composition, setComposition] = useState<Composition>(() => emptyComposition(projectId));
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(12);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState('Add a video clip to preview the edit.');
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Composition[]>([]);
  const [redoStack, setRedoStack] = useState<Composition[]>([]);
  const videoRef = useRef<HTMLVideoElement>(null);

  const assetsQuery = useQuery({
    queryKey: ['assets', projectId],
    queryFn: () => api.get<AssetRow[]>(`/api/projects/${projectId}/assets`),
    enabled: Boolean(projectId),
  });
  const compositionQuery = useQuery({
    queryKey: ['composition', projectId],
    queryFn: () => api.get<{ composition: Composition }>(`/api/projects/${projectId}/composition`),
    enabled: Boolean(projectId),
  });
  const toolsQuery = useQuery({
    queryKey: ['video-render-tools'],
    queryFn: () => api.get<RenderTools>('/api/video-render/tools'),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (compositionQuery.data?.composition) {
      const loaded = compositionQuery.data.composition;
      setComposition({
        ...loaded,
        schemaVersion: 2,
        tracks: [...(loaded.tracks || [])].sort((a, b) => a.order - b.order),
        clips: loaded.clips.map((clip) => ({ ...clip, order: clip.order ?? 0 })),
      });
      setDirty(false);
      setUndoStack([]);
      setRedoStack([]);
      const firstVideo = loaded.clips.find((clip) => clip.trackType === 'video');
      setSelectedClipId(firstVideo?.id || null);
      setSelectedTrackId(firstVideo?.trackId || loaded.tracks?.[0]?.trackId || null);
    }
  }, [compositionQuery.data]);

  const renderingAvailable = toolsQuery.data?.available === true;
  const assets = assetsQuery.data || [];
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const sortedTracks = useMemo(
    () => [...composition.tracks].sort((a, b) => a.order - b.order),
    [composition.tracks]
  );
  const selectedClip = composition.clips.find((clip) => clip.id === selectedClipId) || null;
  const selectedTrack = sortedTracks.find((track) => track.trackId === selectedTrackId) || null;
  const contentEnd = Math.max(
    0,
    ...composition.clips.map((clip) => clip.timelineStartSeconds + (clip.durationSeconds ?? 5))
  );
  const timelineEnd = Math.max(20, Math.ceil(contentEnd + 2), Math.ceil(playhead + 2));
  const tickSeconds = zoom >= 24 ? 1 : zoom >= 10 ? 2 : 5;
  const pxPerSecond = zoom;
  const hasVideoClips = composition.clips.some((clip) => clip.trackType === 'video');

  const visibleVideoClip = useMemo(() => {
    const onVisibleTrack = (clip: Clip) => {
      const track = composition.tracks.find((candidate) => candidate.trackId === clip.trackId);
      return clip.trackType === 'video' && track && !track.hidden;
    };
    if (selectedClip && onVisibleTrack(selectedClip)) return selectedClip;
    const atPlayhead = composition.clips
      .filter((clip) => onVisibleTrack(clip) && clip.timelineStartSeconds <= playhead && endOf(clip) > playhead)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (atPlayhead.length) return atPlayhead[atPlayhead.length - 1];
    return composition.clips.find(onVisibleTrack) || null;
  }, [composition.clips, composition.tracks, playhead, selectedClip]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setIsPlaying(false);
    if (!visibleVideoClip) {
      setPreviewMessage(
        hasVideoClips
          ? 'All video tracks are hidden. Make a video track visible to preview it.'
          : 'Add a video clip to preview the edit.'
      );
      return () => undefined;
    }
    setPreviewMessage('Loading protected video…');
    void api
      .getBlob(`/api/assets/${encodeURIComponent(visibleVideoClip.assetId)}/file`)
      .then((blob) => {
        if (!active) return;
        if (!blob.type.startsWith('video/')) {
          setPreviewMessage('This asset is not a playable video.');
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      })
      .catch(() => active && setPreviewMessage('The protected video could not be loaded.'));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [hasVideoClips, visibleVideoClip?.assetId, visibleVideoClip?.id]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !visibleVideoClip || isPlaying) return;
    const offset = Math.max(
      0,
      Math.min(playhead - visibleVideoClip.timelineStartSeconds, visibleVideoClip.durationSeconds ?? 0)
    );
    const target = visibleVideoClip.sourceInSeconds + offset;
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - target) > 0.25) {
      video.currentTime = Math.min(target, video.duration || target);
    }
  }, [playhead, visibleVideoClip, isPlaying]);

  const save = useMutation({
    mutationFn: () =>
      api.putWithHeaders<{ composition: Composition }>(
        `/api/projects/${projectId}/composition`,
        {
          schemaVersion: 2,
          tracks: composition.tracks.map(({ trackId, name, type, order, muted, hidden, locked }) => ({
            trackId,
            name,
            type,
            order,
            muted,
            hidden,
            locked,
          })),
          clips: composition.clips.map(
            ({ id: _id, durationSeconds: _duration, ...clip }) => ({ ...clip, order: clip.order ?? 0 })
          ),
        },
        { 'If-Match': String(composition.revision) }
      ),
    onSuccess: (response) => {
      const saved = {
        ...response.composition,
        schemaVersion: 2,
        tracks: [...(response.composition.tracks || [])].sort((a, b) => a.order - b.order),
      };
      setComposition(saved);
      setDirty(false);
      setUndoStack([]);
      setRedoStack([]);
      setSelectedClipId((current) =>
        saved.clips.some((clip) => clip.id === current) ? current : saved.clips[0]?.id || null
      );
      if (!saved.tracks.some((track) => track.trackId === selectedTrackId)) {
        setSelectedTrackId(saved.tracks[0]?.trackId || null);
      }
      void queryClient.invalidateQueries({ queryKey: ['composition', projectId] });
    },
  });

  const render = useMutation({
    mutationFn: () =>
      api.postWithHeaders<{ job: RenderJob }>(`/api/projects/${projectId}/renders`, {}, {
        'Idempotency-Key': `render-${projectId}-${composition.revision}`,
      }),
    onSuccess: (response) => setRenderJob(response.job),
  });

  useEffect(() => {
    if (!renderJob || renderJob.status === 'succeeded' || renderJob.status === 'failed' || renderJob.status === 'cancelled') return;
    const timer = setInterval(() => {
      void api
        .get<{ job: RenderJob }>(`/api/video-jobs/${renderJob.id}`)
        .then((response) => setRenderJob(response.job))
        .catch(() => setRenderJob((current) => current ? { ...current, errorMessage: 'Render status could not be refreshed.' } : current));
    }, 1000);
    return () => clearInterval(timer);
  }, [renderJob]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    if (!renderJob?.outputAssetId) {
      setRenderedUrl(null);
      return () => undefined;
    }
    void api
      .getBlob(`/api/assets/${encodeURIComponent(renderJob.outputAssetId)}/file`)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setRenderedUrl(objectUrl);
      })
      .catch(() => active && setRenderedUrl(null));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [renderJob?.outputAssetId]);

  const pushHistory = (snapshot: Composition) => {
    setUndoStack((current) => [...current.slice(-39), snapshot]);
    setRedoStack([]);
  };

  const apply = (next: Composition, historyBase: Composition | null = composition) => {
    if (historyBase) pushHistory(historyBase);
    setComposition(next);
    setDirty(true);
    setEditorError(null);
  };

  const updateClip = (id: string, patch: Partial<Clip>, historyBase: Composition | null = composition) => {
    if (historyBase) pushHistory(historyBase);
    setComposition((current) => ({
      ...current,
      clips: current.clips.map((clip) => (clip.id === id ? { ...clip, ...patch } : clip)),
    }));
    setDirty(true);
  };

  const undo = () => {
    if (!undoStack.length) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack(undoStack.slice(0, -1));
    setRedoStack([...redoStack.slice(-39), composition]);
    setComposition(previous);
    setDirty(true);
  };

  const redo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack(redoStack.slice(0, -1));
    setUndoStack([...undoStack.slice(-39), composition]);
    setComposition(next);
    setDirty(true);
  };

  const addTrack = (type: TrackType) => {
    const sameType = composition.tracks.filter((track) => track.type === type).length;
    const track: Track = {
      trackId: `${type}-${crypto.randomUUID().slice(0, 8)}`,
      name: `${type === 'video' ? 'Video' : type === 'audio' ? 'Audio' : 'Text'} ${sameType + 1}`,
      type,
      order: composition.tracks.reduce((max, item) => Math.max(max, item.order + 1), 0),
      muted: false,
      hidden: false,
      locked: false,
    };
    apply({ ...composition, tracks: [...composition.tracks, track] });
    setSelectedTrackId(track.trackId);
    setSelectedClipId(null);
  };

  const removeTrack = (track: Track) => {
    if (track.locked) {
      setEditorError(`Unlock "${track.name}" before removing it.`);
      return;
    }
    if (composition.clips.some((clip) => clip.trackId === track.trackId)) {
      setEditorError('Remove the clips on this track before deleting the track.');
      return;
    }
    apply({ ...composition, tracks: composition.tracks.filter((item) => item.trackId !== track.trackId) });
    setSelectedTrackId(null);
  };

  const updateTrack = (trackId: string, patch: Partial<Track>, history = true) => {
    apply(
      {
        ...composition,
        tracks: composition.tracks.map((track) =>
          track.trackId === trackId ? { ...track, ...patch } : track
        ),
      },
      history ? composition : null
    );
  };

  const addAsset = (asset: AssetRow) => {
    const type: TrackType = asset.type === 'audio' ? 'audio' : 'video';
    const preferred = selectedTrack && selectedTrack.type === type ? selectedTrack : null;
    let tracks = composition.tracks;
    let track = preferred || tracks.find((item) => item.type === type) || null;
    if (!track) {
      const sameType = tracks.filter((item) => item.type === type).length;
      track = {
        trackId: `${type}-${crypto.randomUUID().slice(0, 8)}`,
        name: `${type === 'video' ? 'Video' : 'Audio'} ${sameType + 1}`,
        type,
        order: tracks.reduce((max, item) => Math.max(max, item.order + 1), 0),
        muted: false,
        hidden: false,
        locked: false,
      };
      tracks = [...tracks, track];
    }
    if (track.locked) {
      setEditorError(`Track "${track.name}" is locked. Unlock it before adding clips.`);
      return;
    }
    const onTrack = composition.clips.filter((clip) => clip.trackId === track!.trackId);
    if (!asset.sourceDurationSeconds && onTrack.length > 0) {
      setEditorError('This asset has no trusted duration; add it to an empty track or re-import it.');
      return;
    }
    const start = onTrack.reduce((end, clip) => Math.max(end, endOf(clip)), 0);
    const clip: Clip = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      trackId: track.trackId,
      trackType: type,
      timelineStartSeconds: start,
      sourceInSeconds: 0,
      sourceOutSeconds: 0,
      durationSeconds: asset.sourceDurationSeconds ?? null,
      order: onTrack.reduce((max, item) => Math.max(max, item.order + 1), 0),
    };
    apply({ ...composition, tracks, clips: [...composition.clips, clip] });
    setSelectedClipId(clip.id || null);
    setSelectedTrackId(track.trackId);
  };

  const splitAtPlayhead = () => {
    const clip =
      (selectedClip && selectedClip.timelineStartSeconds < playhead && playhead < endOf(selectedClip)
        ? selectedClip
        : undefined) ||
      composition.clips.find(
        (candidate) =>
          candidate.trackId === selectedTrackId &&
          candidate.timelineStartSeconds < playhead &&
          playhead < endOf(candidate)
      );
    if (!clip) {
      setEditorError('Place the playhead inside a clip to split it.');
      return;
    }
    const track = composition.tracks.find((candidate) => candidate.trackId === clip.trackId);
    if (track?.locked) {
      setEditorError(`Track "${track.name}" is locked.`);
      return;
    }
    const offset = snap(playhead - clip.timelineStartSeconds);
    if (offset <= 0.05 || offset >= durationOf(clip) - 0.05) {
      setEditorError('The playhead is too close to the clip edge to split.');
      return;
    }
    const left: Clip = {
      ...clip,
      sourceOutSeconds: snap(clip.sourceInSeconds + offset),
      durationSeconds: offset,
    };
    const right: Clip = {
      ...clip,
      id: crypto.randomUUID(),
      timelineStartSeconds: snap(playhead),
      sourceInSeconds: snap(clip.sourceInSeconds + offset),
      sourceOutSeconds: clipRangeEnd(clip),
      durationSeconds: snap(durationOf(clip) - offset),
      order: (clip.order ?? 0) + 1,
    };
    apply({
      ...composition,
      clips: composition.clips.flatMap((candidate) => (candidate === clip ? [left, right] : [candidate])),
    });
    setSelectedClipId(right.id || null);
  };

  const deleteClip = () => {
    if (!selectedClip) return;
    const track = composition.tracks.find((candidate) => candidate.trackId === selectedClip.trackId);
    if (track?.locked) {
      setEditorError(`Track "${track.name}" is locked.`);
      return;
    }
    apply({ ...composition, clips: composition.clips.filter((clip) => clip !== selectedClip) });
    setSelectedClipId(null);
  };

  const seekTo = (value: number) => {
    const next = Math.max(0, Math.min(snap(value), Math.max(0, timelineEnd)));
    setPlayhead(next);
    const video = videoRef.current;
    if (video && visibleVideoClip) {
      video.pause();
      setIsPlaying(false);
      const offset = Math.max(
        0,
        Math.min(next - visibleVideoClip.timelineStartSeconds, visibleVideoClip.durationSeconds ?? 0)
      );
      const target = visibleVideoClip.sourceInSeconds + offset;
      if (Number.isFinite(video.duration)) video.currentTime = Math.min(target, video.duration || target);
    }
  };

  const seekFromPointer = (event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / pxPerSecond);
  };

  const beginClipDrag = (event: React.PointerEvent<HTMLElement>, clip: Clip) => {
    if (event.button !== 0) return;
    const track = composition.tracks.find((candidate) => candidate.trackId === clip.trackId);
    if (track?.locked) {
      setEditorError(`Track "${track.name}" is locked.`);
      return;
    }
    event.stopPropagation();
    setSelectedClipId(clip.id || null);
    setSelectedTrackId(clip.trackId);
    const startX = event.clientX;
    const origin = clip.timelineStartSeconds;
    const historyBase = composition;
    let pushed = false;
    const move = (moveEvent: PointerEvent) => {
      if (!pushed) {
        pushHistory(historyBase);
        pushed = true;
      }
      const next = Math.max(0, snap(origin + (moveEvent.clientX - startX) / pxPerSecond));
      updateClip(clip.id!, { timelineStartSeconds: next }, null);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const beginTrim = (event: React.PointerEvent<HTMLElement>, clip: Clip, edge: 'in' | 'out') => {
    if (event.button !== 0) return;
    const track = composition.tracks.find((candidate) => candidate.trackId === clip.trackId);
    if (track?.locked) {
      setEditorError(`Track "${track.name}" is locked.`);
      return;
    }
    const asset = assetById.get(clip.assetId);
    const sourceDuration = asset?.sourceDurationSeconds ?? clip.sourceInSeconds + durationOf(clip);
    event.stopPropagation();
    setSelectedClipId(clip.id || null);
    setSelectedTrackId(clip.trackId);
    const startX = event.clientX;
    const origin = {
      start: clip.timelineStartSeconds,
      inPoint: clip.sourceInSeconds,
      outPoint: clipRangeEnd(clip),
      duration: durationOf(clip),
    };
    const historyBase = composition;
    let pushed = false;
    const move = (moveEvent: PointerEvent) => {
      if (!pushed) {
        pushHistory(historyBase);
        pushed = true;
      }
      const delta = snap((moveEvent.clientX - startX) / pxPerSecond);
      if (edge === 'out') {
        const outPoint = Math.min(sourceDuration, Math.max(origin.inPoint + 0.1, origin.outPoint + delta));
        updateClip(
          clip.id!,
          { sourceOutSeconds: snap(outPoint), durationSeconds: snap(outPoint - origin.inPoint) },
          null
        );
      } else {
        const inPoint = Math.max(0, Math.min(origin.outPoint - 0.1, origin.inPoint + delta));
        const start = Math.max(0, snap(origin.start + (inPoint - origin.inPoint)));
        updateClip(
          clip.id!,
          {
            sourceInSeconds: snap(inPoint),
            sourceOutSeconds: snap(origin.outPoint),
            durationSeconds: snap(origin.outPoint - inPoint),
            timelineStartSeconds: start,
          },
          null
        );
      }
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const overlappingClipIds = useMemo(() => {
    const ids = new Set<string>();
    const byTrack = new Map<string, Clip[]>();
    for (const clip of composition.clips) {
      byTrack.set(clip.trackId, [...(byTrack.get(clip.trackId) || []), clip]);
    }
    for (const clips of byTrack.values()) {
      const sorted = [...clips].sort((a, b) => a.timelineStartSeconds - b.timelineStartSeconds);
      for (let index = 1; index < sorted.length; index += 1) {
        if (sorted[index].timelineStartSeconds < endOf(sorted[index - 1]) - 0.001) {
          ids.add(sorted[index].id || '');
          ids.add(sorted[index - 1].id || '');
        }
      }
    }
    return ids;
  }, [composition.clips]);

  const trackForClip = (clip: Clip) => composition.tracks.find((track) => track.trackId === clip.trackId);

  if (projectLoading || assetsQuery.isLoading || compositionQuery.isLoading) return <Loading label="Loading editor…" />;
  if (projectError || assetsQuery.error || compositionQuery.error) {
    return <ErrorBox error={projectError || assetsQuery.error || compositionQuery.error} />;
  }
  if (!project) return null;

  const mediaAssets = assets.filter((asset) => asset.type === 'video' || asset.type === 'audio');

  return (
    <div className="space-y-5">
      <SectionTitle
        title={`Video editor · ${project.title}`}
        subtitle="Multi-track, non-destructive editing with protected local FFmpeg rendering."
        action={
          <>
            <Badge tone={dirty ? 'warning' : 'success'}>{dirty ? 'Unsaved changes' : 'Saved'}</Badge>
            <Button variant="ghost" size="sm" disabled={!undoStack.length} onClick={undo} title="Undo last edit">
              <Undo2 className="h-3.5 w-3.5" /> Undo
            </Button>
            <Button variant="ghost" size="sm" disabled={!redoStack.length} onClick={redo} title="Redo last edit">
              <Redo2 className="h-3.5 w-3.5" /> Redo
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={dirty || composition.clips.length === 0 || render.isPending || !renderingAvailable || overlappingClipIds.size > 0}
              loading={render.isPending}
              title={
                dirty
                  ? 'Save the composition before rendering'
                  : overlappingClipIds.size > 0
                    ? 'Resolve overlapping clips before rendering'
                    : toolsQuery.isLoading
                      ? 'Checking the local FFmpeg installation…'
                      : !renderingAvailable
                        ? 'MP4 rendering is unavailable on this server — see the setup note below'
                        : 'Render the saved composition as an MP4 with local FFmpeg'
              }
              onClick={() => render.mutate()}
            >
              {renderJob?.status === 'succeeded' ? 'Render again' : 'Render MP4'}
            </Button>
            <Button size="sm" loading={save.isPending} disabled={!dirty || overlappingClipIds.size > 0} onClick={() => save.mutate()}>
              <Save className="h-3.5 w-3.5" /> Save composition
            </Button>
          </>
        }
      />

      {save.error && <ErrorBox error={save.error} />}
      {render.error && <ErrorBox error={render.error} />}
      {editorError && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          {editorError}
        </div>
      )}
      {toolsQuery.data && !toolsQuery.data.available && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          <p className="font-medium">MP4 rendering is unavailable on this server.</p>
          <p className="mt-1 text-xs">{toolsQuery.data.message}</p>
        </div>
      )}
      {save.error instanceof ApiRequestError && save.error.status === 409 && (
        <p className="text-sm text-amber-700">This composition changed elsewhere. Reload before saving again.</p>
      )}
      {overlappingClipIds.size > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Clips overlap on the same track. Move or trim the highlighted clips before saving or rendering.
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[230px_minmax(0,1fr)_280px]">
        <Card className="space-y-3 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Media assets</h2>
            <span className="text-[11px] text-slate-400">{mediaAssets.length} available</span>
          </div>
          {mediaAssets.length === 0 ? (
            <EmptyState title="No media assets" description="Upload video or audio assets in the Assets section first." />
          ) : (
            mediaAssets.map((asset) => (
              <button
                key={asset.id}
                aria-label={`Add ${asset.name} to timeline`}
                className="flex w-full items-center gap-2 rounded-lg border border-slate-200 p-2 text-left text-xs hover:border-brand-400 dark:border-slate-700"
                onClick={() => addAsset(asset)}
                title={`Add ${asset.name} to the selected compatible track`}
              >
                {asset.type === 'audio' ? <Music className="h-3.5 w-3.5 shrink-0" /> : <Film className="h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                <span className="text-slate-400">
                  {asset.sourceDurationSeconds ? `${asset.sourceDurationSeconds.toFixed(1)}s` : 'Add'}
                </span>
              </button>
            ))
          )}
          <p className="text-[11px] text-slate-500">
            Assets are added to the selected compatible track, or a new track is created. Duration metadata comes from trusted FFprobe inspection.
          </p>
        </Card>

        <Card className="min-w-0 space-y-4 p-4">
          <div className="rounded-lg bg-slate-950 p-3">
            {renderedUrl ? (
              <div>
                <p className="mb-2 text-xs font-medium text-emerald-300">Rendered MP4 output · protected asset</p>
                <video src={renderedUrl} controls preload="metadata" className="mx-auto max-h-72 w-full bg-black" />
              </div>
            ) : previewUrl ? (
              <video
                key={visibleVideoClip?.id}
                ref={videoRef}
                src={previewUrl}
                controls
                preload="metadata"
                className="mx-auto max-h-72 w-full bg-black"
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
                onEnded={() => {
                  setIsPlaying(false);
                  if (visibleVideoClip) setPlayhead(endOf(visibleVideoClip));
                }}
                onTimeUpdate={(event) => {
                  if (!visibleVideoClip) return;
                  const offset = event.currentTarget.currentTime - visibleVideoClip.sourceInSeconds;
                  setPlayhead(
                    snap(
                      Math.max(
                        visibleVideoClip.timelineStartSeconds,
                        Math.min(visibleVideoClip.timelineStartSeconds + offset, endOf(visibleVideoClip))
                      )
                    )
                  );
                }}
              />
            ) : (
              <p className="flex h-48 items-center justify-center text-sm text-slate-400">{previewMessage}</p>
            )}
            {previewUrl && !renderedUrl && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const video = videoRef.current;
                    if (!video) return;
                    if (video.paused) void video.play();
                    else video.pause();
                  }}
                >
                  {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Play / pause
                </Button>
                <span className="text-xs text-slate-400">
                  Preview: {assetById.get(visibleVideoClip?.assetId || '')?.name || 'no clip'}
                </span>
              </div>
            )}
          </div>
          {renderJob && (
            <div className="rounded-lg border border-slate-200 p-3 text-xs dark:border-slate-700">
              <div className="flex items-center justify-between">
                <span className="font-medium">Render status: {renderJob.status}</span>
                <span>{renderJob.progress}%</span>
              </div>
              <p className="mt-1 text-slate-500">{renderJob.errorMessage || renderJob.currentStage}</p>
            </div>
          )}
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Inspector</h2>
          {selectedClip ? (
            <>
              <p className="truncate text-xs font-medium">{assetById.get(selectedClip.assetId)?.name || 'Clip'}</p>
              <p className="text-[11px] text-slate-500">
                {trackForClip(selectedClip)?.name || selectedClip.trackId} · {selectedClip.trackType}
                {trackForClip(selectedClip)?.locked ? ' · locked' : ''}
              </p>
              <label className="block text-xs text-slate-500">
                Timeline position (seconds)
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selectedClip.timelineStartSeconds}
                  disabled={trackForClip(selectedClip)?.locked}
                  onChange={(event) => updateClip(selectedClip.id!, { timelineStartSeconds: Math.max(0, Number(event.target.value)) })}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Source in-point (seconds)
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selectedClip.sourceInSeconds}
                  disabled={selectedClip.durationSeconds === null || trackForClip(selectedClip)?.locked}
                  onChange={(event) => {
                    const next = Math.max(0, Math.min(clipRangeEnd(selectedClip) - 0.1, Number(event.target.value)));
                    updateClip(selectedClip.id!, {
                      sourceInSeconds: next,
                      durationSeconds: snap(clipRangeEnd(selectedClip) - next),
                    });
                  }}
                />
              </label>
              <label className="block text-xs text-slate-500">
                Source out-point (seconds)
                <Input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selectedClip.sourceOutSeconds}
                  disabled={selectedClip.durationSeconds === null || trackForClip(selectedClip)?.locked}
                  onChange={(event) => {
                    const asset = assetById.get(selectedClip.assetId);
                    const max = asset?.sourceDurationSeconds ?? Number.POSITIVE_INFINITY;
                    const next = Math.max(selectedClip.sourceInSeconds + 0.1, Math.min(max, Number(event.target.value)));
                    updateClip(selectedClip.id!, {
                      sourceOutSeconds: next,
                      durationSeconds: snap(next - selectedClip.sourceInSeconds),
                    });
                  }}
                />
              </label>
              <p className="text-[11px] text-slate-500">Duration: {durationOf(selectedClip).toFixed(1)}s</p>
              {selectedClip.durationSeconds === null && (
                <p className="text-[11px] text-amber-700">Trimming is disabled until trusted source-duration metadata is available.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={splitAtPlayhead} title="Split the selected clip at the playhead">
                  <Scissors className="h-3.5 w-3.5" /> Split
                </Button>
                <Button size="sm" variant="danger" onClick={deleteClip} title="Delete selected clip">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </>
          ) : selectedTrack ? (
            <>
              <p className="text-[11px] uppercase tracking-wide text-slate-400">{selectedTrack.type} track</p>
              <label className="block text-xs text-slate-500">
                Track name
                <Input
                  value={selectedTrack.name}
                  disabled={selectedTrack.locked}
                  onChange={(event) => updateTrack(selectedTrack.trackId, { name: event.target.value || selectedTrack.type })}
                />
              </label>
              <div className="flex flex-wrap gap-2">
                {selectedTrack.type !== 'text' && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={selectedTrack.locked}
                    onClick={() =>
                      updateTrack(selectedTrack.trackId, selectedTrack.type === 'video'
                        ? { hidden: !selectedTrack.hidden }
                        : { muted: !selectedTrack.muted })
                    }
                  >
                    {selectedTrack.type === 'video'
                      ? selectedTrack.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />
                      : selectedTrack.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
                    {selectedTrack.type === 'video'
                      ? selectedTrack.hidden ? 'Hidden' : 'Visible'
                      : selectedTrack.muted ? 'Muted' : 'Audible'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => updateTrack(selectedTrack.trackId, { locked: !selectedTrack.locked })}
                >
                  {selectedTrack.locked ? <Unlock className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                  {selectedTrack.locked ? 'Unlock' : 'Lock'}
                </Button>
                <Button size="sm" variant="danger" onClick={() => removeTrack(selectedTrack)}>
                  <Trash2 className="h-3.5 w-3.5" /> Track
                </Button>
              </div>
              {selectedTrack.type === 'text' && (
                <p className="text-[11px] text-slate-500">
                  Text/overlay tracks are organizational only. Text clips are not renderable yet and are rejected at save time.
                </p>
              )}
            </>
          ) : (
            <p className="text-xs text-slate-500">Select a clip or track to edit its properties.</p>
          )}
        </Card>
      </div>

      <Card className="min-w-0 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Timeline</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => addTrack('video')} title="Add a video track">
              <Plus className="h-3.5 w-3.5" /> Video
            </Button>
            <Button size="sm" variant="outline" onClick={() => addTrack('audio')} title="Add an audio track">
              <Plus className="h-3.5 w-3.5" /> Audio
            </Button>
            <Button size="sm" variant="outline" onClick={() => addTrack('text')} title="Add an organizational text track">
              <Plus className="h-3.5 w-3.5" /> Text
            </Button>
            <Button size="sm" variant="outline" onClick={splitAtPlayhead} title="Split at the playhead">
              <Scissors className="h-3.5 w-3.5" /> Split
            </Button>
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 px-1 dark:border-slate-700">
              <button
                className="p-1 text-slate-500 hover:text-brand-600"
                onClick={() => setZoom((value) => Math.max(4, value - 2))}
                aria-label="Zoom out timeline"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <span className="w-10 text-center text-[10px] text-slate-500">{zoom}px/s</span>
              <button
                className="p-1 text-slate-500 hover:text-brand-600"
                onClick={() => setZoom((value) => Math.min(60, value + 2))}
                aria-label="Zoom in timeline"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <div style={{ width: HEADER_WIDTH + timelineEnd * pxPerSecond }} className="min-w-full">
            <div className="flex border-b border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900">
              <div
                className="sticky left-0 z-20 flex h-7 shrink-0 items-center border-r border-slate-200 bg-slate-50 px-2 text-[10px] uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:bg-slate-900"
                style={{ width: HEADER_WIDTH }}
              >
                Tracks
              </div>
              <div
                className="relative h-7 flex-1 cursor-crosshair select-none"
                onPointerDown={seekFromPointer}
                style={{ width: timelineEnd * pxPerSecond }}
              >
                {Array.from({ length: Math.floor(timelineEnd / tickSeconds) + 1 }, (_, index) => {
                  const time = index * tickSeconds;
                  return (
                    <div key={time} className="absolute top-0 h-full border-l border-slate-200 dark:border-slate-700" style={{ left: time * pxPerSecond }}>
                      <span className="ml-1 text-[9px] text-slate-400">{time}s</span>
                    </div>
                  );
                })}
                <div className="pointer-events-none absolute top-0 h-full w-px bg-rose-500" style={{ left: playhead * pxPerSecond }} />
              </div>
            </div>

            {sortedTracks.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-500">
                No tracks yet. Add a video or audio track, or drop a media asset in.
              </div>
            )}

            {[...sortedTracks].reverse().map((track) => (
              <div key={track.trackId} className="flex border-b border-slate-200 last:border-b-0 dark:border-slate-700">
                <div
                  className={`sticky left-0 z-20 flex h-16 shrink-0 items-center gap-1 border-r border-slate-200 px-2 dark:border-slate-700 ${
                    selectedTrackId === track.trackId ? 'bg-brand-50 dark:bg-slate-800' : 'bg-white dark:bg-slate-900'
                  }`}
                  style={{ width: HEADER_WIDTH }}
                  onClick={() => {
                    setSelectedTrackId(track.trackId);
                    setSelectedClipId(null);
                  }}
                >
                  {track.type === 'video' ? <Film className="h-3.5 w-3.5 shrink-0" /> : track.type === 'audio' ? <Music className="h-3.5 w-3.5 shrink-0" /> : <Type className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate text-[11px] font-medium" title={track.name}>{track.name}</span>
                  {track.type !== 'text' && (
                    <button
                      className="p-0.5 text-slate-400 hover:text-brand-600"
                      disabled={track.locked}
                      aria-label={`${track.type === 'video' ? 'Toggle visibility' : 'Toggle mute'} for ${track.name}`}
                      title={track.type === 'video' ? (track.hidden ? 'Hidden' : 'Visible') : track.muted ? 'Muted' : 'Audible'}
                      onClick={(event) => {
                        event.stopPropagation();
                        updateTrack(track.trackId, track.type === 'video' ? { hidden: !track.hidden } : { muted: !track.muted });
                      }}
                    >
                      {track.type === 'video'
                        ? track.hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />
                        : track.muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
                    </button>
                  )}
                  <button
                    className="p-0.5 text-slate-400 hover:text-brand-600"
                    aria-label={`${track.locked ? 'Unlock' : 'Lock'} ${track.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      updateTrack(track.trackId, { locked: !track.locked });
                    }}
                  >
                    {track.locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                  </button>
                </div>
                <div
                  className="relative h-16 cursor-crosshair select-none bg-slate-50/50 dark:bg-slate-800/40"
                  style={{ width: timelineEnd * pxPerSecond }}
                  onPointerDown={seekFromPointer}
                >
                  {composition.clips
                    .filter((clip) => clip.trackId === track.trackId)
                    .map((clip) => {
                      const width = Math.max(24, (clip.durationSeconds ?? 5) * pxPerSecond);
                      const isSelected = clip.id === selectedClipId;
                      const isOverlapping = overlappingClipIds.has(clip.id || '');
                      return (
                        <button
                          key={clip.id || `${clip.assetId}-${clip.timelineStartSeconds}`}
                          className={`absolute top-3 h-10 overflow-hidden rounded px-2 text-left text-[10px] text-white ${
                            track.type === 'audio' ? 'bg-emerald-600' : 'bg-brand-500'
                          } ${isSelected ? 'ring-2 ring-brand-200' : ''} ${isOverlapping ? 'ring-2 ring-amber-400' : ''}`}
                          style={{ left: clip.timelineStartSeconds * pxPerSecond, width }}
                          onPointerDown={(event) => beginClipDrag(event, clip)}
                          title={`${assetById.get(clip.assetId)?.name || 'Clip'} · ${(clip.durationSeconds ?? 0).toFixed(1)}s`}
                        >
                          <span className="block truncate font-medium">{assetById.get(clip.assetId)?.name || 'Clip'}</span>
                          <span className="block truncate opacity-80">{(clip.durationSeconds ?? 0).toFixed(1)}s</span>
                          {!track.locked && (
                            <>
                              <span
                                role="presentation"
                                className="absolute left-0 top-0 h-full w-2 cursor-ew-resize bg-black/20"
                                onPointerDown={(event) => beginTrim(event, clip, 'in')}
                              />
                              <span
                                role="presentation"
                                className="absolute right-0 top-0 h-full w-2 cursor-ew-resize bg-black/20"
                                onPointerDown={(event) => beginTrim(event, clip, 'out')}
                              />
                            </>
                          )}
                        </button>
                      );
                    })}
                  <div className="pointer-events-none absolute top-0 h-full w-px bg-rose-500" style={{ left: playhead * pxPerSecond }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] text-slate-500">Playhead</span>
          <Input
            aria-label="Timeline playhead"
            type="number"
            min={0}
            max={timelineEnd}
            step={0.1}
            value={playhead}
            className="w-24"
            onChange={(event) => seekTo(Number(event.target.value))}
          />
          <span className="text-[11px] text-slate-500">seconds</span>
          <span className="ml-auto text-[11px] text-slate-500">
            {composition.clips.length} clip(s) · {sortedTracks.length} track(s) · {contentEnd.toFixed(1)}s content
          </span>
        </div>
      </Card>

      <p className="text-xs text-slate-500">
        <Film className="mr-1 inline h-3.5 w-3.5" />
        Rendering uses local FFmpeg and stores the resulting MP4 as a protected project asset. No paid rendering service is used.
        Text/overlay clips are not rendered yet; empty text tracks are organizational.
      </p>
    </div>
  );
}
