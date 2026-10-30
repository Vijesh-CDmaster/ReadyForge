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
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, SectionTitle, Select, Textarea } from '../components/ui';
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
  volume: number;
}

type TextAlignment = 'left' | 'center' | 'right';
type AnimationEasing = 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
type EntranceType = 'fade' | 'slide-left' | 'slide-right' | 'slide-top' | 'slide-bottom' | 'zoom' | 'pop';
type ExitType = 'fade' | 'slide-left' | 'slide-right' | 'slide-top' | 'slide-bottom' | 'zoom';

interface AnimationSettings {
  type: string;
  durationSeconds: number;
  delaySeconds: number;
  easing: AnimationEasing;
}

interface TextAnimation {
  version: 1;
  entrance: AnimationSettings | null;
  exit: AnimationSettings | null;
}

type TransitionType =
  | 'crossfade'
  | 'fade-black'
  | 'fade-white'
  | 'wipe-left'
  | 'wipe-right'
  | 'slide-left'
  | 'slide-right';

interface ClipTransition {
  type: TransitionType;
  durationSeconds: number;
}

interface ClipAudio {
  volume: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
}

interface TextStyle {
  content: string;
  x: number;
  y: number;
  width: number;
  alignment: TextAlignment;
  fontFamily: 'sans' | 'serif' | 'mono';
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
  animation: TextAnimation | null;
}

interface Clip {
  id?: string;
  assetId: string | null;
  trackId: string;
  trackType: TrackType;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds: number | null;
  order: number;
  text: TextStyle | null;
  transitionIn: ClipTransition | null;
  audio: ClipAudio | null;
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
  if (clip.trackType === 'text') return clampNumber(clip.durationSeconds ?? 0, 0, 3600);
  return Math.max(0, clipRangeEnd(clip) - clip.sourceInSeconds);
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function defaultTextStyle(content = 'New title'): TextStyle {
  return {
    content,
    x: 0.5,
    y: 0.78,
    width: 0.8,
    alignment: 'center',
    fontFamily: 'sans',
    fontSize: 48,
    fontColor: '#ffffff',
    backgroundColor: '#000000',
    backgroundOpacity: 0.45,
    textOpacity: 1,
    bold: false,
    italic: false,
    shadow: false,
    outline: false,
    outlineColor: '#000000',
    outlineWidth: 2,
    zIndex: 0,
    animation: null,
  };
}

const ENTRANCE_OPTIONS: Array<{ value: EntranceType; label: string }> = [
  { value: 'fade', label: 'Fade in' },
  { value: 'slide-left', label: 'Slide from left' },
  { value: 'slide-right', label: 'Slide from right' },
  { value: 'slide-top', label: 'Slide from top' },
  { value: 'slide-bottom', label: 'Slide from bottom' },
  { value: 'zoom', label: 'Zoom in' },
  { value: 'pop', label: 'Pop in' },
];

const EXIT_OPTIONS: Array<{ value: ExitType; label: string }> = [
  { value: 'fade', label: 'Fade out' },
  { value: 'slide-left', label: 'Slide out left' },
  { value: 'slide-right', label: 'Slide out right' },
  { value: 'slide-top', label: 'Slide out top' },
  { value: 'slide-bottom', label: 'Slide out bottom' },
  { value: 'zoom', label: 'Zoom out' },
];

const EASING_OPTIONS: AnimationEasing[] = ['linear', 'ease-in', 'ease-out', 'ease-in-out'];

const TRANSITION_OPTIONS: Array<{ value: TransitionType; label: string }> = [
  { value: 'crossfade', label: 'Crossfade' },
  { value: 'fade-black', label: 'Fade through black' },
  { value: 'fade-white', label: 'Fade through white' },
  { value: 'wipe-left', label: 'Wipe from left' },
  { value: 'wipe-right', label: 'Wipe from right' },
  { value: 'slide-left', label: 'Slide left' },
  { value: 'slide-right', label: 'Slide right' },
];

function defaultAnimationSettings(type: string): AnimationSettings {
  return { type, durationSeconds: 0.6, delaySeconds: 0, easing: 'ease-out' };
}

const GLYPH_WIDTH_RATIO = 0.56;

function wrapOverlayText(content: string, widthPixels: number, fontSize: number): string {
  const maxChars = Math.max(1, Math.floor(widthPixels / (fontSize * GLYPH_WIDTH_RATIO)));
  const lines: string[] = [];
  for (const paragraph of content.replace(/\r\n/g, '\n').split('\n')) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (candidate.length <= maxChars) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      if (word.length > maxChars) {
        let rest = word;
        while (rest.length > maxChars) {
          lines.push(rest.slice(0, maxChars));
          rest = rest.slice(maxChars);
        }
        line = rest;
      } else {
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines.slice(0, 20).join('\n');
}

function hexToRgba(hex: string, opacity: number): string {
  const value = /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : '#000000';
  return `rgba(${parseInt(value.slice(1, 3), 16)}, ${parseInt(value.slice(3, 5), 16)}, ${parseInt(value.slice(5, 7), 16)}, ${clampNumber(opacity, 0, 1)})`;
}

/*
 * Preview animation state is a pure function of the absolute playhead time,
 * mirroring the FFmpeg expressions in server/src/services/animations.ts. No CSS
 * timers are used, so pausing and seeking always show the correct frame.
 */
function easeProgress(progress: number, easing: AnimationEasing): number {
  const p = clampNumber(progress, 0, 1);
  switch (easing) {
    case 'linear':
      return p;
    case 'ease-in':
      return p * p;
    case 'ease-out':
      return 1 - (1 - p) * (1 - p);
    case 'ease-in-out':
      return p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p);
    default:
      return p;
  }
}

function animationWindow(
  settings: AnimationSettings,
  clipStart: number,
  clipEnd: number,
  direction: 'in' | 'out'
): { start: number; end: number } {
  const delay = settings.delaySeconds ?? 0;
  if (direction === 'in') {
    const start = clipStart + delay;
    return { start, end: start + settings.durationSeconds };
  }
  const end = clipEnd - delay;
  return { start: end - settings.durationSeconds, end };
}

function animationOpacity(
  animation: TextAnimation | null,
  clipStart: number,
  clipEnd: number,
  time: number
): number {
  if (!animation) return 1;
  let factor = 1;
  const entrance = animation.entrance;
  if (entrance?.type === 'fade') {
    const { start, end } = animationWindow(entrance, clipStart, clipEnd, 'in');
    factor *= time <= start ? 0 : time >= end ? 1 : easeProgress((time - start) / (end - start), entrance.easing);
  }
  const exit = animation.exit;
  if (exit?.type === 'fade') {
    const { start, end } = animationWindow(exit, clipStart, clipEnd, 'out');
    factor *= time <= start ? 1 : time >= end ? 0 : 1 - easeProgress((time - start) / (end - start), exit.easing);
  }
  return clampNumber(factor, 0, 1);
}

function slideVector(type: string): { axis: 'x' | 'y'; sign: 1 | -1 } | null {
  if (type === 'slide-left') return { axis: 'x', sign: -1 };
  if (type === 'slide-right') return { axis: 'x', sign: 1 };
  if (type === 'slide-top') return { axis: 'y', sign: -1 };
  if (type === 'slide-bottom') return { axis: 'y', sign: 1 };
  return null;
}

function animationOffset(
  animation: TextAnimation | null,
  axis: 'x' | 'y',
  size: number,
  clipStart: number,
  clipEnd: number,
  time: number
): number {
  if (!animation) return 0;
  let offset = 0;
  const entrance = animation.entrance;
  if (entrance) {
    const vector = slideVector(entrance.type);
    if (vector?.axis === axis) {
      const { start, end } = animationWindow(entrance, clipStart, clipEnd, 'in');
      const eased = easeProgress((time - start) / (end - start), entrance.easing);
      offset += time <= start ? vector.sign * size : time >= end ? 0 : vector.sign * size * (1 - eased);
    }
  }
  const exit = animation.exit;
  if (exit) {
    const vector = slideVector(exit.type);
    if (vector?.axis === axis) {
      const { start, end } = animationWindow(exit, clipStart, clipEnd, 'out');
      const eased = easeProgress((time - start) / (end - start), exit.easing);
      offset += time <= start ? 0 : time >= end ? vector.sign * size : vector.sign * size * eased;
    }
  }
  return offset;
}

/** Scale mirrors the renderer's zoom layer (0.55–1, 1.08 peak for pop). */
function animationScale(
  animation: TextAnimation | null,
  clipStart: number,
  clipEnd: number,
  time: number
): number {
  if (!animation) return 1;
  let scale = 1;
  const entrance = animation.entrance;
  if (entrance && (entrance.type === 'zoom' || entrance.type === 'pop')) {
    const { start, end } = animationWindow(entrance, clipStart, clipEnd, 'in');
    const eased = easeProgress((time - start) / (end - start), entrance.easing);
    const peak = entrance.type === 'pop' ? 1.08 : 1;
    scale *= time <= start ? 0.55 : time >= end ? 1 : 0.55 + (peak - 0.55) * eased;
  }
  const exit = animation.exit;
  if (exit?.type === 'zoom') {
    const { start, end } = animationWindow(exit, clipStart, clipEnd, 'out');
    const eased = easeProgress((time - start) / (end - start), exit.easing);
    scale *= time <= start ? 1 : time >= end ? 0.55 : 1 - 0.45 * eased;
  }
  return scale;
}

const EXTENDED_TRANSITIONS: readonly TransitionType[] = ['crossfade', 'wipe-left', 'wipe-right', 'slide-left', 'slide-right'];

interface PreviewTransition {
  type: TransitionType;
  /** Progress across the whole transition window. */
  progress: number;
  outgoing: Clip;
  incoming: Clip | null;
}

function findPreviewTransition(clips: Clip[], time: number): PreviewTransition | null {
  for (const incoming of clips) {
    const transition = incoming.transitionIn;
    if (!transition) continue;
    const start = incoming.timelineStartSeconds;
    const duration = transition.durationSeconds;
    const isExtended = EXTENDED_TRANSITIONS.includes(transition.type);
    const windowStart = isExtended ? start : start - duration / 2;
    const windowEnd = isExtended ? start + duration : start + duration / 2;
    if (time < windowStart || time > windowEnd) continue;
    const outgoing = clips.find(
      (candidate) =>
        candidate.trackId === incoming.trackId &&
        Math.abs(endOf(candidate) - start) <= 0.011
    );
    if (!outgoing) continue;
    return {
      type: transition.type,
      progress: clampNumber((time - windowStart) / duration, 0, 1),
      outgoing,
      incoming: time < start && !isExtended ? null : incoming,
    };
  }
  return null;
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
  const [outgoingPreviewUrl, setOutgoingPreviewUrl] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState('Add a video clip to preview the edit.');
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [renderedUrl, setRenderedUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Composition[]>([]);
  const [redoStack, setRedoStack] = useState<Composition[]>([]);
  const [previewWidth, setPreviewWidth] = useState(0);
  const [srtBusy, setSrtBusy] = useState(false);
  const [srtSummary, setSrtSummary] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const outgoingVideoRef = useRef<HTMLVideoElement>(null);
  // Programmatic seeks clamp video.currentTime to the visible clip; the resulting
  // timeupdate must not pull the timeline playhead back to that clip's range.
  const programmaticSeekTargetRef = useRef<number | null>(null);
  const previewBoxRef = useRef<HTMLDivElement>(null);
  const srtInputRef = useRef<HTMLInputElement>(null);

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
        tracks: [...(loaded.tracks || [])]
          .sort((a, b) => a.order - b.order)
          .map((track) => ({ ...track, volume: track.volume ?? 1 })),
        clips: loaded.clips.map((clip) => ({
          ...clip,
          assetId: clip.assetId ?? null,
          order: clip.order ?? 0,
          text: clip.text ? { ...clip.text, animation: clip.text.animation ?? null } : null,
          transitionIn: clip.transitionIn ?? null,
          audio: clip.audio ?? null,
        })),
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
  const previousTouchingClip =
    selectedClip && selectedClip.trackType === 'video'
      ? composition.clips.find(
          (candidate) =>
            candidate.id !== selectedClip.id &&
            candidate.trackId === selectedClip.trackId &&
            Math.abs(endOf(candidate) - selectedClip.timelineStartSeconds) <= 0.011
        ) || null
      : null;
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

  const previewTransition = useMemo(() => {
    const visibleTrackIds = new Set(
      composition.tracks.filter((track) => track.type === 'video' && !track.hidden).map((track) => track.trackId)
    );
    const clips = composition.clips.filter((clip) => clip.trackType === 'video' && visibleTrackIds.has(clip.trackId));
    return findPreviewTransition(clips, playhead);
  }, [composition.clips, composition.tracks, playhead]);

  const transitionStyle = useMemo<React.CSSProperties | undefined>(() => {
    if (!previewTransition) return undefined;
    const p = previewTransition.progress;
    switch (previewTransition.type) {
      case 'crossfade':
        return { opacity: p };
      case 'wipe-left':
        return { clipPath: `inset(0 ${(1 - p) * 100}% 0 0)` };
      case 'wipe-right':
        return { clipPath: `inset(0 0 0 ${(1 - p) * 100}%)` };
      case 'slide-left':
        return { transform: `translateX(${(1 - p) * 100}%)` };
      case 'slide-right':
        return { transform: `translateX(${-(1 - p) * 100}%)` };
      default:
        return undefined;
    }
  }, [previewTransition]);

  const flashColor =
    previewTransition?.type === 'fade-black'
      ? '#000000'
      : previewTransition?.type === 'fade-white'
        ? '#ffffff'
        : null;
  const flashOpacity =
    flashColor && previewTransition ? 1 - Math.abs(2 * previewTransition.progress - 1) : 0;

  const previewTextClips = useMemo(() => {
    const trackOrder = new Map(composition.tracks.map((track) => [track.trackId, track.order]));
    const visibleTextTracks = new Set(
      composition.tracks.filter((track) => track.type === 'text' && !track.hidden).map((track) => track.trackId)
    );
    return composition.clips
      .filter(
        (clip) =>
          clip.trackType === 'text' &&
          visibleTextTracks.has(clip.trackId) &&
          clip.text &&
          clip.timelineStartSeconds <= playhead &&
          endOf(clip) > playhead
      )
      .sort(
        (a, b) =>
          (trackOrder.get(a.trackId) ?? 0) - (trackOrder.get(b.trackId) ?? 0) ||
          (a.text?.zIndex ?? 0) - (b.text?.zIndex ?? 0) ||
          (a.order ?? 0) - (b.order ?? 0)
      );
  }, [composition.clips, composition.tracks, playhead]);

  useEffect(() => {
    const element = previewBoxRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPreviewWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [previewUrl, renderedUrl]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    setIsPlaying(false);
    if (!visibleVideoClip?.assetId) {
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
    let active = true;
    let objectUrl: string | null = null;
    setOutgoingPreviewUrl(null);
    const outgoing = previewTransition?.outgoing ?? null;
    if (!outgoing?.assetId || outgoing.assetId === visibleVideoClip?.assetId) {
      return () => undefined;
    }
    void api
      .getBlob(`/api/assets/${encodeURIComponent(outgoing.assetId)}/file`)
      .then((blob) => {
        if (!active || !blob.type.startsWith('video/')) return;
        objectUrl = URL.createObjectURL(blob);
        setOutgoingPreviewUrl(objectUrl);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [previewTransition?.outgoing?.assetId, previewTransition?.outgoing?.id, visibleVideoClip?.assetId]);

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

  useEffect(() => {
    const video = outgoingVideoRef.current;
    const outgoing = previewTransition?.outgoing;
    if (!video || !outgoing || isPlaying) return;
    const offset = Math.max(
      0,
      Math.min(playhead - outgoing.timelineStartSeconds, outgoing.durationSeconds ?? 0)
    );
    const target = outgoing.sourceInSeconds + offset;
    if (Number.isFinite(video.duration) && Math.abs(video.currentTime - target) > 0.25) {
      video.currentTime = Math.min(target, video.duration || target);
    }
  }, [playhead, previewTransition?.outgoing, isPlaying]);

  const save = useMutation({
    mutationFn: () =>
      api.putWithHeaders<{ composition: Composition }>(
        `/api/projects/${projectId}/composition`,
        {
          schemaVersion: 2,
          tracks: composition.tracks.map(({ trackId, name, type, order, muted, hidden, locked, volume }) => ({
            trackId,
            name,
            type,
            order,
            muted,
            hidden,
            locked,
            volume: type === 'audio' ? volume ?? 1 : 1,
          })),
          clips: composition.clips.map(
            ({ id: _id, durationSeconds, ...clip }) =>
              clip.trackType === 'text'
                ? {
                    trackId: clip.trackId,
                    trackType: clip.trackType,
                    timelineStartSeconds: clip.timelineStartSeconds,
                    durationSeconds: durationSeconds ?? 2,
                    order: clip.order ?? 0,
                    text: clip.text,
                  }
                : {
                    assetId: clip.assetId,
                    trackId: clip.trackId,
                    trackType: clip.trackType,
                    timelineStartSeconds: clip.timelineStartSeconds,
                    sourceInSeconds: clip.sourceInSeconds,
                    sourceOutSeconds: clip.sourceOutSeconds,
                    order: clip.order ?? 0,
                    transitionIn: clip.transitionIn ?? undefined,
                    audio: clip.audio ?? undefined,
                  }
          ),
        },
        { 'If-Match': String(composition.revision) }
      ),
    onSuccess: (response) => {
      const saved = {
        ...response.composition,
        schemaVersion: 2,
        tracks: [...(response.composition.tracks || [])]
          .sort((a, b) => a.order - b.order)
          .map((track) => ({ ...track, volume: track.volume ?? 1 })),
        clips: response.composition.clips.map((clip) => ({
          ...clip,
          assetId: clip.assetId ?? null,
          order: clip.order ?? 0,
          text: clip.text ? { ...clip.text, animation: clip.text.animation ?? null } : null,
          transitionIn: clip.transitionIn ?? null,
          audio: clip.audio ?? null,
        })),
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
      clips: current.clips.map((clip) => {
        if (clip.id !== id) return clip;
        const next = { ...clip, ...patch };
        // Animations may never outlive their clip; shrink or drop them so the
        // composition always satisfies the server's validation rules.
        if (next.text?.animation && next.durationSeconds !== null) {
          const limit = next.durationSeconds;
          const fit = (settings: AnimationSettings | null): AnimationSettings | null => {
            if (!settings) return null;
            const available = limit - (settings.delaySeconds ?? 0);
            if (available < 0.05) return null;
            return settings.durationSeconds <= available
              ? settings
              : { ...settings, durationSeconds: Math.max(0.05, available) };
          };
          const animation = {
            ...next.text.animation,
            entrance: fit(next.text.animation.entrance),
            exit: fit(next.text.animation.exit),
          };
          next.text = {
            ...next.text,
            animation: animation.entrance || animation.exit ? animation : null,
          };
        }
        return next;
      }),
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
      volume: 1,
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
        volume: 1,
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
      text: null,
      transitionIn: null,
      audio: null,
    };
    apply({ ...composition, tracks, clips: [...composition.clips, clip] });
    setSelectedClipId(clip.id || null);
    setSelectedTrackId(track.trackId);
  };

  const addTextClip = () => {
    let tracks = composition.tracks;
    let track = selectedTrack?.type === 'text' ? selectedTrack : tracks.find((item) => item.type === 'text') || null;
    if (!track) {
      const sameType = tracks.filter((item) => item.type === 'text').length;
      track = {
        trackId: `text-${crypto.randomUUID().slice(0, 8)}`,
        name: `Text ${sameType + 1}`,
        type: 'text',
        order: tracks.reduce((max, item) => Math.max(max, item.order + 1), 0),
        muted: false,
        hidden: false,
        locked: false,
        volume: 1,
      };
      tracks = [...tracks, track];
    }
    if (track.locked) {
      setEditorError(`Track "${track.name}" is locked.`);
      return;
    }
    const onTrack = composition.clips.filter((clip) => clip.trackId === track!.trackId);
    const clip: Clip = {
      id: crypto.randomUUID(),
      assetId: null,
      trackId: track.trackId,
      trackType: 'text',
      timelineStartSeconds: snap(playhead),
      sourceInSeconds: 0,
      sourceOutSeconds: 0,
      durationSeconds: 2,
      order: onTrack.reduce((max, item) => Math.max(max, item.order + 1), 0),
      text: defaultTextStyle('New title'),
      transitionIn: null,
      audio: null,
    };
    apply({ ...composition, tracks, clips: [...composition.clips, clip] });
    setSelectedClipId(clip.id || null);
    setSelectedTrackId(track.trackId);
  };

  const updateSelectedText = (patch: Partial<TextStyle>, history = true) => {
    if (!selectedClip?.text) return;
    updateClip(
      selectedClip.id!,
      { text: { ...selectedClip.text, ...patch } },
      history ? composition : null
    );
  };

  const updateSelectedAnimation = (patch: Partial<TextAnimation> | null, history = true) => {
    if (!selectedClip?.text) return;
    const current = selectedClip.text.animation;
    const next: TextAnimation | null = patch === null ? null : { ...(current ?? { version: 1, entrance: null, exit: null }), ...patch, version: 1 };
    updateSelectedText({ animation: next }, history);
  };

  const updateTransition = (patch: Partial<ClipTransition> | null, history = true) => {
    if (!selectedClip || selectedClip.trackType !== 'video') return;
    const next = patch === null ? null : { ...(selectedClip.transitionIn ?? { type: 'crossfade' as TransitionType, durationSeconds: 0.6 }), ...patch };
    updateClip(selectedClip.id!, { transitionIn: next }, history ? composition : null);
  };

  const updateSelectedAudio = (patch: Partial<ClipAudio>, history = true) => {
    if (!selectedClip || selectedClip.trackType !== 'audio') return;
    const current = selectedClip.audio ?? { volume: 1, fadeInSeconds: 0, fadeOutSeconds: 0 };
    updateClip(selectedClip.id!, { audio: { ...current, ...patch } }, history ? composition : null);
  };

  const duplicateSelectedClip = () => {
    if (!selectedClip) return;
    const track = selectedClip.trackId;
    const onTrack = composition.clips.filter((clip) => clip.trackId === track);
    const copy: Clip = {
      ...selectedClip,
      id: crypto.randomUUID(),
      timelineStartSeconds: snap(endOf(selectedClip)),
      order: onTrack.reduce((max, item) => Math.max(max, item.order + 1), 0),
      text: selectedClip.text ? { ...selectedClip.text } : null,
    };
    apply({ ...composition, clips: [...composition.clips, copy] });
    setSelectedClipId(copy.id || null);
  };

  const importSrt = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setSrtBusy(true);
    setSrtSummary(null);
    try {
      const srt = await file.text();
      const parsed = await api.post<{ cues: Array<{ startSeconds: number; endSeconds: number; text: string }>; count: number }>(
        '/api/subtitles/parse',
        { srt }
      );
      if (composition.clips.length + parsed.cues.length > 500) {
        throw new Error('The composition cannot hold more than 500 clips.');
      }
      let tracks = composition.tracks;
      let track = selectedTrack?.type === 'text' ? selectedTrack : tracks.find((item) => item.type === 'text') || null;
      if (!track) {
        const sameType = tracks.filter((item) => item.type === 'text').length;
        track = {
          trackId: `text-${crypto.randomUUID().slice(0, 8)}`,
          name: `Subtitles ${sameType + 1}`,
          type: 'text',
          order: tracks.reduce((max, item) => Math.max(max, item.order + 1), 0),
          muted: false,
          hidden: false,
          locked: false,
          volume: 1,
        };
        tracks = [...tracks, track];
      }
      if (track.locked) throw new Error(`Track "${track.name}" is locked.`);
      const onTrack = composition.clips.filter((clip) => clip.trackId === track!.trackId);
      const baseOrder = onTrack.reduce((max, item) => Math.max(max, item.order + 1), 0);
      const created: Clip[] = parsed.cues.map((cue, index) => ({
        id: crypto.randomUUID(),
        assetId: null,
        trackId: track!.trackId,
        trackType: 'text',
        timelineStartSeconds: snap(cue.startSeconds),
        sourceInSeconds: 0,
        sourceOutSeconds: 0,
        durationSeconds: Math.max(0.1, snap(cue.endSeconds - cue.startSeconds)),
        order: baseOrder + index,
        text: { ...defaultTextStyle(cue.text), y: 0.88, width: 0.9, backgroundOpacity: 0.55 },
        transitionIn: null,
        audio: null,
      }));
      apply({ ...composition, tracks, clips: [...composition.clips, ...created] });
      setSelectedTrackId(track.trackId);
      setSelectedClipId(created[0]?.id || null);
      setSrtSummary(`Imported ${created.length} subtitle cue(s). Review and save the composition.`);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : 'Subtitle import failed.');
    } finally {
      setSrtBusy(false);
    }
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
    const left: Clip = clip.trackType === 'text'
      ? { ...clip, durationSeconds: offset }
      : {
          ...clip,
          sourceOutSeconds: snap(clip.sourceInSeconds + offset),
          durationSeconds: offset,
        };
    const right: Clip = clip.trackType === 'text'
      ? {
          ...clip,
          id: crypto.randomUUID(),
          timelineStartSeconds: snap(playhead),
          durationSeconds: snap(durationOf(clip) - offset),
          order: (clip.order ?? 0) + 1,
          text: clip.text ? { ...clip.text } : null,
        }
      : {
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
      if (Number.isFinite(video.duration)) {
        const clamped = Math.min(target, video.duration || target);
        programmaticSeekTargetRef.current = clamped;
        video.currentTime = clamped;
      }
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
    const asset = clip.assetId ? assetById.get(clip.assetId) : undefined;
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
      if (clip.trackType === 'text') {
        if (edge === 'out') {
          updateClip(clip.id!, { durationSeconds: Math.max(0.1, snap(origin.duration + delta)) }, null);
        } else {
          const start = Math.max(0, snap(origin.start + delta));
          const duration = Math.max(0.1, snap(origin.duration - (start - origin.start)));
          updateClip(clip.id!, { timelineStartSeconds: start, durationSeconds: duration }, null);
        }
        return;
      }
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
    const textTracks = new Set(
      composition.tracks.filter((track) => track.type === 'text').map((track) => track.trackId)
    );
    for (const clip of composition.clips) {
      if (textTracks.has(clip.trackId)) continue;
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
  }, [composition.clips, composition.tracks]);

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
      {srtSummary && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          {srtSummary}
        </div>
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
              <div
                ref={previewBoxRef}
                className="relative mx-auto aspect-video w-full max-w-3xl overflow-hidden bg-black"
              >
                {outgoingPreviewUrl && previewTransition && (
                  <video
                    key={`outgoing-${previewTransition.outgoing.id}`}
                    ref={outgoingVideoRef}
                    src={outgoingPreviewUrl}
                    muted
                    preload="auto"
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                  />
                )}
                <video
                  key={visibleVideoClip?.id}
                  ref={videoRef}
                  src={previewUrl}
                  controls
                  preload="metadata"
                  style={transitionStyle}
                  className="absolute inset-0 h-full w-full object-contain"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => {
                    setIsPlaying(false);
                    if (visibleVideoClip) setPlayhead(endOf(visibleVideoClip));
                  }}
                  onTimeUpdate={(event) => {
                    if (!visibleVideoClip) return;
                    const target = programmaticSeekTargetRef.current;
                    if (target !== null && Math.abs(event.currentTarget.currentTime - target) < 0.1) {
                      programmaticSeekTargetRef.current = null;
                      return;
                    }
                    programmaticSeekTargetRef.current = null;
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
                {flashColor && (
                  <div
                    data-preview-flash={flashColor}
                    className="pointer-events-none absolute inset-0"
                    style={{ backgroundColor: flashColor, opacity: flashOpacity }}
                  />
                )}
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    style={{
                      width: 1280,
                      height: 720,
                      transform: `scale(${previewWidth ? previewWidth / 1280 : 1})`,
                      transformOrigin: 'top left',
                    }}
                  >
                    {previewTextClips.map((clip) => {
                      const text = clip.text;
                      if (!text) return null;
                      const start = clip.timelineStartSeconds;
                      const end = endOf(clip);
                      const opacity = animationOpacity(text.animation, start, end, playhead);
                      const dx = animationOffset(text.animation, 'x', 1280, start, end, playhead);
                      const dy = animationOffset(text.animation, 'y', 720, start, end, playhead);
                      const scale = animationScale(text.animation, start, end, playhead);
                      return (
                        <div
                          key={clip.id}
                          data-preview-text={clip.id}
                          data-preview-opacity={opacity.toFixed(3)}
                          data-preview-scale={scale.toFixed(3)}
                          style={{
                            position: 'absolute',
                            left: (text.x - text.width / 2) * 1280,
                            top: text.y * 720,
                            width: text.width * 1280,
                            opacity,
                            transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${scale.toFixed(3)})`,
                            transformOrigin: 'center top',
                            textAlign: text.alignment,
                            fontFamily:
                              text.fontFamily === 'serif'
                                ? 'Georgia, "Times New Roman", serif'
                                : text.fontFamily === 'mono'
                                  ? 'Consolas, "Courier New", monospace'
                                  : 'Arial, Helvetica, sans-serif',
                            fontSize: text.fontSize,
                            lineHeight: 1.2,
                            fontWeight: text.bold ? 700 : 400,
                            fontStyle: text.italic ? 'italic' : 'normal',
                            color: hexToRgba(text.fontColor, text.textOpacity),
                            whiteSpace: 'pre-wrap',
                            textShadow: text.shadow ? '2px 2px 3px rgba(0,0,0,0.75)' : undefined,
                            WebkitTextStroke: text.outline
                              ? `${text.outlineWidth}px ${hexToRgba(text.outlineColor, 0.9)}`
                              : undefined,
                            zIndex: text.zIndex,
                          }}
                        >
                          <span
                            style={{
                              backgroundColor:
                                text.backgroundOpacity > 0
                                  ? hexToRgba(text.backgroundColor, text.backgroundOpacity)
                                  : 'transparent',
                              padding: '0.08em 0.18em',
                              boxDecorationBreak: 'clone',
                            }}
                          >
                            {wrapOverlayText(text.content, text.width * 1280, text.fontSize)}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
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
            selectedClip.trackType === 'text' && selectedClip.text ? (
              <>
                <p className="truncate text-xs font-medium">Text · {trackForClip(selectedClip)?.name || selectedClip.trackId}</p>
                <label className="block text-xs text-slate-500">
                  Text content
                  <Textarea
                    aria-label="Text content"
                    value={selectedClip.text.content}
                    maxLength={1000}
                    disabled={trackForClip(selectedClip)?.locked}
                    onChange={(event) => updateSelectedText({ content: event.target.value })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-500">
                    Start (s)
                    <Input
                      type="number"
                      min={0}
                      step={0.1}
                      value={selectedClip.timelineStartSeconds}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) =>
                        updateClip(selectedClip.id!, {
                          timelineStartSeconds: Math.max(0, Number(event.target.value)),
                        })
                      }
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Duration (s)
                    <Input
                      type="number"
                      min={0.1}
                      max={3600}
                      step={0.1}
                      value={selectedClip.durationSeconds ?? 2}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) =>
                        updateClip(selectedClip.id!, {
                          durationSeconds: clampNumber(Number(event.target.value), 0.1, 3600),
                        })
                      }
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-500">
                    Font
                    <Select
                      aria-label="Font family"
                      value={selectedClip.text.fontFamily}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ fontFamily: event.target.value as TextStyle['fontFamily'] })}
                    >
                      <option value="sans">Sans</option>
                      <option value="serif">Serif</option>
                      <option value="mono">Mono</option>
                    </Select>
                  </label>
                  <label className="block text-xs text-slate-500">
                    Alignment
                    <Select
                      aria-label="Text alignment"
                      value={selectedClip.text.alignment}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ alignment: event.target.value as TextAlignment })}
                    >
                      <option value="left">Left</option>
                      <option value="center">Center</option>
                      <option value="right">Right</option>
                    </Select>
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-500">
                    Font size
                    <Input
                      type="number"
                      min={8}
                      max={200}
                      value={selectedClip.text.fontSize}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ fontSize: clampNumber(Number(event.target.value), 8, 200) })}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Width
                    <Input
                      type="number"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={selectedClip.text.width}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ width: clampNumber(Number(event.target.value), 0.05, 1) })}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    X (0–1)
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedClip.text.x}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ x: clampNumber(Number(event.target.value), 0, 1) })}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Y (0–1)
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={selectedClip.text.y}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ y: clampNumber(Number(event.target.value), 0, 1) })}
                    />
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-500">
                    Text colour
                    <Input
                      type="color"
                      value={selectedClip.text.fontColor}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ fontColor: event.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Background
                    <Input
                      type="color"
                      value={selectedClip.text.backgroundColor}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ backgroundColor: event.target.value })}
                    />
                  </label>
                </div>
                <label className="block text-xs text-slate-500">
                  Text opacity ({selectedClip.text.textOpacity.toFixed(2)})
                  <Input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedClip.text.textOpacity}
                    disabled={trackForClip(selectedClip)?.locked}
                    onChange={(event) => updateSelectedText({ textOpacity: Number(event.target.value) })}
                  />
                </label>
                <label className="block text-xs text-slate-500">
                  Background opacity ({selectedClip.text.backgroundOpacity.toFixed(2)})
                  <Input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={selectedClip.text.backgroundOpacity}
                    disabled={trackForClip(selectedClip)?.locked}
                    onChange={(event) => updateSelectedText({ backgroundOpacity: Number(event.target.value) })}
                  />
                </label>
                <div className="flex flex-wrap gap-2 text-[11px] text-slate-600 dark:text-slate-300">
                  <label className="flex items-center gap-1"><input type="checkbox" checked={selectedClip.text.bold} disabled={trackForClip(selectedClip)?.locked} onChange={(event) => updateSelectedText({ bold: event.target.checked })} /> Bold</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={selectedClip.text.italic} disabled={trackForClip(selectedClip)?.locked} onChange={(event) => updateSelectedText({ italic: event.target.checked })} /> Italic</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={selectedClip.text.shadow} disabled={trackForClip(selectedClip)?.locked} onChange={(event) => updateSelectedText({ shadow: event.target.checked })} /> Shadow</label>
                  <label className="flex items-center gap-1"><input type="checkbox" checked={selectedClip.text.outline} disabled={trackForClip(selectedClip)?.locked} onChange={(event) => updateSelectedText({ outline: event.target.checked })} /> Outline</label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <label className="block text-xs text-slate-500">
                    Outline width
                    <Input
                      type="number"
                      min={0}
                      max={10}
                      value={selectedClip.text.outlineWidth}
                      disabled={trackForClip(selectedClip)?.locked || !selectedClip.text.outline}
                      onChange={(event) => updateSelectedText({ outlineWidth: clampNumber(Number(event.target.value), 0, 10) })}
                    />
                  </label>
                  <label className="block text-xs text-slate-500">
                    Z-index
                    <Input
                      type="number"
                      min={0}
                      max={1000}
                      value={selectedClip.text.zIndex}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedText({ zIndex: clampNumber(Number(event.target.value), 0, 1000) })}
                    />
                  </label>
                </div>
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Animation</p>
                  {(['entrance', 'exit'] as const).map((slot) => {
                    const settings = selectedClip.text?.animation?.[slot] ?? null;
                    const options = slot === 'entrance' ? ENTRANCE_OPTIONS : EXIT_OPTIONS;
                    return (
                      <div key={slot} className="space-y-1">
                        <label className="block text-xs text-slate-500">
                          {slot === 'entrance' ? 'Entrance' : 'Exit'}
                          <Select
                            aria-label={`${slot} animation`}
                            value={settings?.type ?? ''}
                            disabled={trackForClip(selectedClip)?.locked}
                            onChange={(event) => {
                              const value = event.target.value;
                              if (!value) {
                                updateSelectedAnimation({ [slot]: null } as Partial<TextAnimation>);
                                return;
                              }
                              updateSelectedAnimation({
                                [slot]: { ...(settings ?? defaultAnimationSettings(value)), type: value },
                              } as Partial<TextAnimation>);
                            }}
                          >
                            <option value="">None</option>
                            {options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </Select>
                        </label>
                        {settings && (
                          <div className="grid grid-cols-2 gap-2">
                            <label className="block text-xs text-slate-500">
                              Duration (s)
                              <Input
                                type="number"
                                min={0.05}
                                max={10}
                                step={0.05}
                                value={settings.durationSeconds}
                                disabled={trackForClip(selectedClip)?.locked}
                                onChange={(event) =>
                                  updateSelectedAnimation({
                                    [slot]: { ...settings, durationSeconds: clampNumber(Number(event.target.value), 0.05, 10) },
                                  } as Partial<TextAnimation>)
                                }
                              />
                            </label>
                            <label className="block text-xs text-slate-500">
                              Delay (s)
                              <Input
                                type="number"
                                min={0}
                                max={10}
                                step={0.05}
                                value={settings.delaySeconds}
                                disabled={trackForClip(selectedClip)?.locked}
                                onChange={(event) =>
                                  updateSelectedAnimation({
                                    [slot]: { ...settings, delaySeconds: clampNumber(Number(event.target.value), 0, 10) },
                                  } as Partial<TextAnimation>)
                                }
                              />
                            </label>
                            <label className="col-span-2 block text-xs text-slate-500">
                              Easing
                              <Select
                                aria-label={`${slot} easing`}
                                value={settings.easing}
                                disabled={trackForClip(selectedClip)?.locked}
                                onChange={(event) =>
                                  updateSelectedAnimation({
                                    [slot]: { ...settings, easing: event.target.value as AnimationEasing },
                                  } as Partial<TextAnimation>)
                                }
                              >
                                {EASING_OPTIONS.map((easing) => (
                                  <option key={easing} value={easing}>
                                    {easing}
                                  </option>
                                ))}
                              </Select>
                            </label>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={trackForClip(selectedClip)?.locked || !selectedClip.text.animation}
                    onClick={() => updateSelectedAnimation(null)}
                  >
                    Reset animations
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={splitAtPlayhead} title="Split the selected text clip at the playhead">
                    <Scissors className="h-3.5 w-3.5" /> Split
                  </Button>
                  <Button size="sm" variant="outline" onClick={duplicateSelectedClip} title="Duplicate the selected clip">
                    Duplicate
                  </Button>
                  <Button size="sm" variant="danger" onClick={deleteClip} title="Delete selected clip">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </div>
              </>
            ) : (
            <>
              <p className="truncate text-xs font-medium">{selectedClip.assetId ? assetById.get(selectedClip.assetId)?.name || 'Clip' : 'Clip'}</p>
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
                    const asset = selectedClip.assetId ? assetById.get(selectedClip.assetId) : undefined;
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
              {selectedClip.trackType === 'video' && (
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Transition in</p>
                  {!previousTouchingClip ? (
                    <p className="text-[11px] text-slate-500">
                      Place this clip directly after another clip on the same track to add a transition.
                    </p>
                  ) : (
                    <>
                      <Select
                        aria-label="Transition type"
                        value={selectedClip.transitionIn?.type ?? ''}
                        disabled={trackForClip(selectedClip)?.locked}
                        onChange={(event) => {
                          const value = event.target.value as TransitionType | '';
                          if (!value) {
                            updateTransition(null);
                            return;
                          }
                          updateTransition({ type: value });
                        }}
                      >
                        <option value="">None</option>
                        {TRANSITION_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                      {selectedClip.transitionIn && (
                        <label className="block text-xs text-slate-500">
                          Duration (s)
                          <Input
                            type="number"
                            min={0.1}
                            max={Math.min(5, durationOf(previousTouchingClip), durationOf(selectedClip))}
                            step={0.1}
                            value={selectedClip.transitionIn.durationSeconds}
                            disabled={trackForClip(selectedClip)?.locked}
                            onChange={(event) =>
                              updateTransition({
                                durationSeconds: clampNumber(
                                  Number(event.target.value),
                                  0.1,
                                  Math.min(5, durationOf(previousTouchingClip), durationOf(selectedClip))
                                ),
                              })
                            }
                          />
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}
              {selectedClip.trackType === 'audio' && (
                <div className="space-y-2 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">Audio</p>
                  <label className="block text-xs text-slate-500">
                    Volume ({(selectedClip.audio?.volume ?? 1).toFixed(2)})
                    <input
                      aria-label="Clip volume"
                      type="range"
                      min={0}
                      max={2}
                      step={0.05}
                      className="w-full"
                      value={selectedClip.audio?.volume ?? 1}
                      disabled={trackForClip(selectedClip)?.locked}
                      onChange={(event) => updateSelectedAudio({ volume: Number(event.target.value) })}
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-500">
                      Fade in (s)
                      <Input
                        type="number"
                        min={0}
                        max={Math.max(0, durationOf(selectedClip))}
                        step={0.1}
                        value={selectedClip.audio?.fadeInSeconds ?? 0}
                        disabled={trackForClip(selectedClip)?.locked}
                        onChange={(event) =>
                          updateSelectedAudio({
                            fadeInSeconds: clampNumber(Number(event.target.value), 0, durationOf(selectedClip)),
                          })
                        }
                      />
                    </label>
                    <label className="block text-xs text-slate-500">
                      Fade out (s)
                      <Input
                        type="number"
                        min={0}
                        max={Math.max(0, durationOf(selectedClip))}
                        step={0.1}
                        value={selectedClip.audio?.fadeOutSeconds ?? 0}
                        disabled={trackForClip(selectedClip)?.locked}
                        onChange={(event) =>
                          updateSelectedAudio({
                            fadeOutSeconds: clampNumber(Number(event.target.value), 0, durationOf(selectedClip)),
                          })
                        }
                      />
                    </label>
                  </div>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={splitAtPlayhead} title="Split the selected clip at the playhead">
                  <Scissors className="h-3.5 w-3.5" /> Split
                </Button>
                <Button size="sm" variant="outline" onClick={duplicateSelectedClip} title="Duplicate the selected clip">
                  Duplicate
                </Button>
                <Button size="sm" variant="danger" onClick={deleteClip} title="Delete selected clip">
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
              </div>
            </>
            )
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
              {selectedTrack.type === 'audio' && (
                <label className="block text-xs text-slate-500">
                  Track volume ({(selectedTrack.volume ?? 1).toFixed(2)})
                  <input
                    aria-label="Track volume"
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    className="w-full"
                    value={selectedTrack.volume ?? 1}
                    disabled={selectedTrack.locked}
                    onChange={(event) =>
                      updateTrack(selectedTrack.trackId, { volume: Number(event.target.value) })
                    }
                  />
                </label>
              )}
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
                  Text clips render with local FFmpeg drawtext using an approved font. Overlapping titles are ordered by z-index.
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
            <Button size="sm" variant="outline" onClick={() => addTrack('text')} title="Add an empty text track">
              <Plus className="h-3.5 w-3.5" /> Text track
            </Button>
            <Button size="sm" variant="outline" onClick={addTextClip} title="Add a text clip at the playhead">
              <Type className="h-3.5 w-3.5" /> Add text
            </Button>
            <Button
              size="sm"
              variant="outline"
              loading={srtBusy}
              onClick={() => srtInputRef.current?.click()}
              title="Import an SRT subtitle file into text clips"
            >
              Import SRT
            </Button>
            <input
              ref={srtInputRef}
              type="file"
              accept=".srt,text/plain"
              aria-label="Import SRT subtitles"
              className="hidden"
              onChange={(event) => void importSrt(event)}
            />
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
                          key={clip.id || `${clip.assetId || 'text'}-${clip.timelineStartSeconds}`}
                          className={`absolute top-3 h-10 overflow-hidden rounded px-2 text-left text-[10px] text-white ${
                            track.type === 'audio' ? 'bg-emerald-600' : 'bg-brand-500'
                          } ${isSelected ? 'ring-2 ring-brand-200' : ''} ${isOverlapping ? 'ring-2 ring-amber-400' : ''}`}
                          style={{ left: clip.timelineStartSeconds * pxPerSecond, width }}
                          onPointerDown={(event) => beginClipDrag(event, clip)}
                          title={`${clip.trackType === 'text' ? clip.text?.content.split('\n')[0] || 'Text' : assetById.get(clip.assetId || '')?.name || 'Clip'} · ${(clip.durationSeconds ?? 0).toFixed(1)}s`}
                        >
                          <span className="block truncate font-medium">
                            {clip.trackType === 'text'
                              ? clip.text?.content.split('\n')[0] || 'Text'
                              : assetById.get(clip.assetId || '')?.name || 'Clip'}
                          </span>
                          <span className="block truncate opacity-80">{(clip.durationSeconds ?? 0).toFixed(1)}s</span>
                          {clip.trackType === 'text' && clip.text?.animation && (
                            <span className="pointer-events-none absolute inset-0" data-animation-region={clip.id}>
                              {clip.text.animation.entrance && (
                                <span
                                  className="absolute inset-y-0 left-0 bg-white/30"
                                  data-animation-entry
                                  style={{
                                    width: Math.min(
                                      width,
                                      (clip.text.animation.entrance.durationSeconds +
                                        clip.text.animation.entrance.delaySeconds) *
                                        pxPerSecond
                                    ),
                                  }}
                                />
                              )}
                              {clip.text.animation.exit && (
                                <span
                                  className="absolute inset-y-0 right-0 bg-black/30"
                                  data-animation-exit
                                  style={{
                                    width: Math.min(
                                      width,
                                      (clip.text.animation.exit.durationSeconds +
                                        clip.text.animation.exit.delaySeconds) *
                                        pxPerSecond
                                    ),
                                  }}
                                />
                              )}
                            </span>
                          )}
                          {clip.trackType === 'audio' && clip.audio && (
                            <span className="pointer-events-none absolute inset-0" data-audio-envelope={clip.id}>
                              {clip.audio.fadeInSeconds > 0 && (
                                <span
                                  className="absolute inset-y-0 left-0 bg-gradient-to-r from-white/70 to-transparent"
                                  style={{ width: Math.min(width, clip.audio.fadeInSeconds * pxPerSecond) }}
                                />
                              )}
                              {clip.audio.fadeOutSeconds > 0 && (
                                <span
                                  className="absolute inset-y-0 right-0 bg-gradient-to-l from-white/70 to-transparent"
                                  style={{ width: Math.min(width, clip.audio.fadeOutSeconds * pxPerSecond) }}
                                />
                              )}
                            </span>
                          )}
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
                  {composition.clips
                    .filter(
                      (clip) =>
                        clip.trackId === track.trackId &&
                        clip.trackType === 'video' &&
                        clip.transitionIn
                    )
                    .map((clip) => {
                      const transition = clip.transitionIn!;
                      return (
                        <div
                          key={`transition-${clip.id}`}
                          data-transition-marker={transition.type}
                          className="pointer-events-none absolute top-0 h-2 rounded-b bg-amber-400/90 dark:bg-amber-300"
                          title={`${transition.type} · ${transition.durationSeconds.toFixed(1)}s`}
                          style={{
                            left: Math.max(0, (clip.timelineStartSeconds - transition.durationSeconds / 2) * pxPerSecond),
                            width: Math.max(10, transition.durationSeconds * pxPerSecond),
                          }}
                        />
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
        Text clips are burned into the MP4 with FFmpeg drawtext using approved local fonts, and SRT imports become timed text clips.
      </p>
    </div>
  );
}
