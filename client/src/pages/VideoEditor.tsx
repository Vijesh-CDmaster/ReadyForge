import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Film, Pause, Play, Save, Trash2 } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { api, ApiRequestError } from '../lib/api';
import { Badge, Button, Card, EmptyState, ErrorBox, Input, Loading, SectionTitle } from '../components/ui';
import { useProject } from './ProjectLayout';

interface AssetRow {
  id: string;
  name: string;
  type: 'video' | 'audio' | string;
  fileUrl: string;
  mimeType: string;
  sourceDurationSeconds?: number;
}

interface Clip {
  id?: string;
  assetId: string;
  trackId: string;
  trackType: 'video' | 'audio';
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  durationSeconds: number | null;
}

interface Composition {
  id: string | null;
  projectId: string;
  schemaVersion: number;
  revision: number;
  clips: Clip[];
  updatedAt: string | null;
}

const emptyComposition = (projectId: string): Composition => ({
  id: null,
  projectId,
  schemaVersion: 1,
  revision: 0,
  clips: [],
  updatedAt: null,
});

export default function VideoEditor() {
  const { projectId = '' } = useParams();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject();
  const queryClient = useQueryClient();
  const [composition, setComposition] = useState<Composition>(() => emptyComposition(projectId));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewMessage, setPreviewMessage] = useState('Select a video clip to preview it.');
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

  useEffect(() => {
    if (compositionQuery.data?.composition) {
      setComposition(compositionQuery.data.composition);
      setDirty(false);
      setSelectedId(compositionQuery.data.composition.clips[0]?.id || null);
    }
  }, [compositionQuery.data]);

  const assets = assetsQuery.data || [];
  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);
  const selected = composition.clips.find((clip) => clip.id === selectedId) || null;
  const selectedAsset = selected ? assetById.get(selected.assetId) : undefined;
  const timelineEnd = Math.max(
    30,
    ...composition.clips.map((clip) => (clip.durationSeconds ? clip.timelineStartSeconds + clip.durationSeconds : clip.timelineStartSeconds + 10))
  );
  const scale = 8;

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    setPreviewUrl(null);
    if (!selected || selected.trackType !== 'video') {
      setPreviewMessage('Select a video clip to preview it.');
      return () => undefined;
    }
    setPreviewMessage('Loading protected video…');
    void api
      .getBlob(`/api/assets/${encodeURIComponent(selected.assetId)}/file`)
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
  }, [selected?.assetId, selected?.trackType]);

  useEffect(() => {
    if (videoRef.current) videoRef.current.currentTime = selected?.sourceInSeconds || 0;
  }, [selected?.id, selected?.sourceInSeconds]);

  const save = useMutation({
    mutationFn: () =>
      api.putWithHeaders<{ composition: Composition }>(
        `/api/projects/${projectId}/composition`,
        { schemaVersion: composition.schemaVersion, clips: composition.clips.map(({ id: _id, durationSeconds: _duration, ...clip }) => clip) },
        { 'If-Match': String(composition.revision) }
      ),
    onSuccess: (response) => {
      setComposition(response.composition);
      setDirty(false);
      void queryClient.invalidateQueries({ queryKey: ['composition', projectId] });
    },
  });

  const markChanged = (clips: Clip[]) => {
    setComposition((current) => ({ ...current, clips }));
    setDirty(true);
  };

  const importAsset = (asset: AssetRow) => {
    const trackType = asset.type === 'audio' ? 'audio' : 'video';
    const trackId = `${trackType}-1`;
    const sameTrack = composition.clips.filter((clip) => clip.trackId === trackId);
    const knownEnd = sameTrack.reduce(
      (end, clip) => Math.max(end, clip.timelineStartSeconds + (clip.durationSeconds || 0)),
      0
    );
    const clip: Clip = {
      id: crypto.randomUUID(),
      assetId: asset.id,
      trackId,
      trackType,
      timelineStartSeconds: knownEnd,
      sourceInSeconds: 0,
      sourceOutSeconds: 0,
      durationSeconds: asset.sourceDurationSeconds ?? null,
    };
    const next = [...composition.clips, clip];
    markChanged(next);
    setSelectedId(clip.id || null);
  };

  const updateSelected = (patch: Partial<Clip>) => {
    if (!selected) return;
    markChanged(composition.clips.map((clip) => (clip === selected ? { ...clip, ...patch } : clip)));
  };

  const move = (direction: -1 | 1) => {
    if (!selected) return;
    const index = composition.clips.indexOf(selected);
    const target = index + direction;
    if (target < 0 || target >= composition.clips.length) return;
    const next = [...composition.clips];
    [next[index], next[target]] = [next[target], next[index]];
    markChanged(next);
  };

  if (projectLoading || assetsQuery.isLoading || compositionQuery.isLoading) return <Loading label="Loading editor…" />;
  if (projectError || assetsQuery.error || compositionQuery.error) {
    return <ErrorBox error={projectError || assetsQuery.error || compositionQuery.error} />;
  }
  if (!project) return null;

  return (
    <div className="space-y-5">
      <SectionTitle
        title={`Video editor · ${project.title}`}
        subtitle="Timeline foundation: arrange existing media and save a non-destructive composition. Rendering is not available yet."
        action={
          <>
            <Badge tone={dirty ? 'warning' : 'success'}>{dirty ? 'Unsaved changes' : 'Saved'}</Badge>
            <Button variant="outline" size="sm" disabled title="Real MP4 rendering is not available in Phase 1">
              Export unavailable
            </Button>
            <Button size="sm" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              <Save className="h-3.5 w-3.5" /> Save composition
            </Button>
          </>
        }
      />

      {save.error && <ErrorBox error={save.error} />}
      {save.error instanceof ApiRequestError && save.error.status === 409 && (
        <p className="text-sm text-amber-700">This composition changed elsewhere. Reload before saving again.</p>
      )}

      <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_250px]">
        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Media assets</h2>
          {assets.filter((asset) => asset.type === 'video' || asset.type === 'audio').length === 0 ? (
            <EmptyState title="No media assets" description="Upload video or audio assets in the Assets section first." />
          ) : (
            assets
              .filter((asset) => asset.type === 'video' || asset.type === 'audio')
              .map((asset) => (
                <button
                  key={asset.id}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-200 p-2 text-left text-xs hover:border-brand-400 dark:border-slate-700"
                  onClick={() => importAsset(asset)}
                >
                  <span className="min-w-0 truncate">{asset.name}</span>
                  <span className="ml-2 text-slate-400">Add</span>
                </button>
              ))
          )}
          <p className="text-[11px] text-slate-500">Source duration is shown only when trusted metadata exists. Unknown-duration clips cannot share a track.</p>
        </Card>

        <Card className="min-w-0 space-y-4 p-4">
          <div className="rounded-lg bg-slate-950 p-3">
            {previewUrl ? (
              <video
                ref={videoRef}
                src={previewUrl}
                controls
                preload="metadata"
                className="mx-auto max-h-72 w-full bg-black"
                onTimeUpdate={(event) => setPlayhead(event.currentTarget.currentTime)}
              />
            ) : (
              <p className="flex h-48 items-center justify-center text-sm text-slate-400">{previewMessage}</p>
            )}
            {previewUrl && (
              <div className="mt-2 flex items-center justify-center gap-2">
                <Button size="sm" variant="ghost" onClick={() => (videoRef.current?.paused ? void videoRef.current?.play() : videoRef.current?.pause())}>
                  {videoRef.current?.paused === false ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />} Play / pause
                </Button>
              </div>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <div className="relative min-w-[640px]" style={{ width: `${timelineEnd * scale}px` }}>
              <div className="mb-2 flex justify-between text-[10px] text-slate-400">
                {Array.from({ length: Math.ceil(timelineEnd / 5) + 1 }, (_, index) => <span key={index}>{index * 5}s</span>)}
              </div>
              {(['video-1', 'audio-1'] as const).map((track) => (
                <div key={track} className="relative mb-2 h-14 rounded bg-slate-100 dark:bg-slate-800">
                  <span className="absolute left-2 top-1 text-[10px] uppercase text-slate-400">{track.split('-')[0]}</span>
                  {composition.clips.filter((clip) => clip.trackId === track).map((clip) => {
                    const width = Math.max(90, (clip.durationSeconds || 10) * scale);
                    return (
                      <button
                        key={clip.id || `${clip.assetId}-${clip.timelineStartSeconds}`}
                        className={`absolute top-5 h-7 truncate rounded bg-brand-500 px-2 text-left text-[10px] text-white ${selected === clip ? 'ring-2 ring-brand-200' : ''}`}
                        style={{ left: `${clip.timelineStartSeconds * scale}px`, width }}
                        onClick={() => setSelectedId(clip.id || `${clip.assetId}-${clip.timelineStartSeconds}`)}
                      >
                        {assetById.get(clip.assetId)?.name || 'Asset'} · {clip.durationSeconds ? `${clip.durationSeconds}s` : 'duration unknown'}
                      </button>
                    );
                  })}
                </div>
              ))}
              <input
                aria-label="Timeline playhead"
                type="range"
                min={0}
                max={timelineEnd}
                step={0.1}
                value={playhead}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setPlayhead(value);
                  if (videoRef.current) videoRef.current.currentTime = value;
                }}
                className="absolute left-0 top-0 w-full opacity-0"
              />
              <div className="pointer-events-none absolute top-0 h-full w-px bg-rose-500" style={{ left: `${playhead * scale}px` }} />
            </div>
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="text-sm font-semibold">Clip properties</h2>
          {!selected ? (
            <p className="text-xs text-slate-500">Select a clip to edit its position and source range.</p>
          ) : (
            <>
              <p className="truncate text-xs font-medium">{selectedAsset?.name}</p>
              <label className="block text-xs text-slate-500">Timeline position (seconds)<Input type="number" min={0} step={0.1} value={selected.timelineStartSeconds} onChange={(e) => updateSelected({ timelineStartSeconds: Number(e.target.value) })} /></label>
              <label className="block text-xs text-slate-500">Source in-point (seconds)<Input type="number" min={0} step={0.1} value={selected.sourceInSeconds} disabled={selected.durationSeconds === null} onChange={(e) => updateSelected({ sourceInSeconds: Number(e.target.value) })} /></label>
              <label className="block text-xs text-slate-500">Source out-point (seconds)<Input type="number" min={0} step={0.1} value={selected.sourceOutSeconds} disabled={selected.durationSeconds === null} onChange={(e) => updateSelected({ sourceOutSeconds: Number(e.target.value) })} /></label>
              {selected.durationSeconds === null && <p className="text-[11px] text-amber-700">Trimming is disabled until trusted source-duration metadata is available.</p>}
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => move(-1)} title="Move clip earlier in composition"><ArrowUp className="h-3.5 w-3.5" /> Up</Button>
                <Button size="sm" variant="outline" onClick={() => move(1)} title="Move clip later in composition"><ArrowDown className="h-3.5 w-3.5" /> Down</Button>
                <Button size="sm" variant="danger" onClick={() => { markChanged(composition.clips.filter((clip) => clip !== selected)); setSelectedId(null); }}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            </>
          )}
        </Card>
      </div>

      <p className="text-xs text-slate-500"><Film className="mr-1 inline h-3.5 w-3.5" />This phase saves edit instructions only. It does not render or export a final MP4.</p>
    </div>
  );
}
