import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import VideoEditor from '../pages/VideoEditor';
import { api } from '../lib/api';

const project = {
  id: 'p1',
  workspaceId: 'w1',
  workspaceName: 'Workspace',
  workspaceRole: 'owner',
  title: 'Editor project',
  description: '',
  projectType: 'video',
  status: 'draft',
  mode: 'solo',
  objective: '',
  audience: '',
  tone: '',
  callToAction: '',
  successMetric: '',
  deadline: null,
  budget: { amount: 0, currency: 'INR', spent: 0, remaining: 0 },
  currentStage: 'concept',
  readinessScore: 0,
  inputCounts: {},
  latestContract: null,
  members: [],
  createdAt: '',
  updatedAt: '',
};

interface ToolsFixture {
  available: boolean;
  ffmpeg: { available: boolean; version: string | null; error: string | null };
  ffprobe: { available: boolean; version: string | null; error: string | null };
  missingCodecs: string[];
  message: string | null;
}

const availableTools: ToolsFixture = {
  available: true,
  ffmpeg: { available: true, version: '7.1.1', error: null },
  ffprobe: { available: true, version: '7.1.1', error: null },
  missingCodecs: [],
  message: null,
};

const unavailableTools: ToolsFixture = {
  available: false,
  ffmpeg: { available: false, version: null, error: 'ffmpeg was not found on PATH.' },
  ffprobe: { available: false, version: null, error: 'ffprobe was not found on PATH.' },
  missingCodecs: [],
  message: 'ffmpeg was not found on PATH. Set FFMPEG_PATH to a working ffmpeg executable.',
};

const populatedComposition = {
  composition: {
    id: 'c1',
    projectId: 'p1',
    schemaVersion: 2,
    revision: 2,
    tracks: [
      { trackId: 'video-1', name: 'Main', type: 'video', order: 0, muted: false, hidden: false, locked: false },
      { trackId: 'audio-1', name: 'Music', type: 'audio', order: 1, muted: false, hidden: false, locked: false },
    ],
    clips: [{ id: 'clip1', assetId: 'a1', trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 1, sourceOutSeconds: 5, durationSeconds: 4, order: 0 }],
    updatedAt: null,
  },
};

function mockApi(tools: ToolsFixture, empty = false) {
  vi.spyOn(api, 'get').mockImplementation((path) => {
    if (path === '/api/projects/p1') return Promise.resolve(project) as never;
    if (path === '/api/video-render/tools') return Promise.resolve(tools) as never;
    if (path === '/api/projects/p1/assets') {
      return Promise.resolve(
        empty
          ? []
          : [{ id: 'a1', name: 'clip.mp4', type: 'video', fileUrl: '/api/assets/a1/file', mimeType: 'video/mp4', sourceDurationSeconds: 12 }]
      ) as never;
    }
    if (path === '/api/projects/p1/composition') {
      return Promise.resolve(
        empty
          ? { composition: { id: null, projectId: 'p1', schemaVersion: 1, revision: 0, clips: [], updatedAt: null } }
          : populatedComposition
      ) as never;
    }
    return Promise.resolve({ composition: { id: null, projectId: 'p1', schemaVersion: 1, revision: 0, clips: [], updatedAt: null } }) as never;
  });
}

function renderEditor() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/app/projects/p1/editor']}>
        <Routes>
          <Route path="/app/projects/:projectId/editor" element={<VideoEditor />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('VideoEditor', () => {
  it('shows loading state while the project request is pending', () => {
    vi.spyOn(api, 'get').mockImplementation(() => new Promise(() => undefined) as never);
    renderEditor();
    expect(screen.getByText('Loading editor…')).toBeTruthy();
  });

  it('shows the empty media state', async () => {
    mockApi(availableTools, true);
    renderEditor();
    expect(await screen.findByText('No media assets')).toBeTruthy();
    expect(screen.getByText(/Multi-track, non-destructive editing/)).toBeTruthy();
  });

  it('renders populated assets and clip properties', async () => {
    mockApi(availableTools);
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    renderEditor();
    expect(await screen.findByText('clip.mp4')).toBeTruthy();
    expect(screen.getByText('Inspector')).toBeTruthy();
    expect(screen.getByDisplayValue('1')).toBeTruthy();
    await waitFor(() => {
      const renderButton = screen.getByRole('button', { name: 'Render MP4' });
      expect(renderButton.hasAttribute('disabled')).toBe(false);
    });
  });

  it('adds clips, splits at the playhead, and supports undo and redo', async () => {
    mockApi(availableTools);
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    renderEditor();
    await screen.findByText('clip.mp4');

    fireEvent.click(screen.getByRole('button', { name: 'Add clip.mp4 to timeline' }));
    await waitFor(() => expect(document.querySelectorAll('button[title^="clip.mp4 ·"]')).toHaveLength(2));

    fireEvent.change(screen.getByLabelText('Timeline playhead'), { target: { value: '2' } });
    fireEvent.click(screen.getAllByRole('button', { name: /Split/ })[0]);
    await waitFor(() => expect(document.querySelectorAll('button[title^="clip.mp4 ·"]')).toHaveLength(3));

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(document.querySelectorAll('button[title^="clip.mp4 ·"]')).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /Redo/ }));
    await waitFor(() => expect(document.querySelectorAll('button[title^="clip.mp4 ·"]')).toHaveLength(3));
  });

  it('adds and edits a text clip and shows it in the preview', async () => {
    mockApi(availableTools);
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    renderEditor();
    await screen.findByText('clip.mp4');

    fireEvent.click(screen.getByRole('button', { name: /Add text/ }));
    const content = (await screen.findByLabelText('Text content')) as HTMLTextAreaElement;
    expect(content.value).toBe('New title');
    fireEvent.change(content, { target: { value: 'Launch day' } });
    await waitFor(() => {
      expect(document.querySelector('[data-preview-text]')?.textContent).toContain('Launch day');
    });
    expect(screen.getByRole('button', { name: /Duplicate/ })).toBeTruthy();
  });

  it('keeps a video preview when an audio clip is selected', async () => {
    mockApi(availableTools);
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    vi.spyOn(api, 'get').mockImplementation((path) => {
      if (path === '/api/projects/p1') return Promise.resolve(project) as never;
      if (path === '/api/video-render/tools') return Promise.resolve(availableTools) as never;
      if (path === '/api/projects/p1/assets') {
        return Promise.resolve([
          { id: 'a1', name: 'clip.mp4', type: 'video', fileUrl: '/api/assets/a1/file', mimeType: 'video/mp4', sourceDurationSeconds: 12 },
          { id: 'a2', name: 'music.wav', type: 'audio', fileUrl: '/api/assets/a2/file', mimeType: 'audio/wav', sourceDurationSeconds: 12 },
        ]) as never;
      }
      if (path === '/api/projects/p1/composition') {
        return Promise.resolve({
          composition: {
            ...populatedComposition.composition,
            clips: [
              ...populatedComposition.composition.clips,
              { id: 'clip2', assetId: 'a2', trackId: 'audio-1', trackType: 'audio', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 4, durationSeconds: 4, order: 0 },
            ],
          },
        }) as never;
      }
      return Promise.resolve({}) as never;
    });
    renderEditor();
    await screen.findByText('music.wav');
    fireEvent.click(screen.getByRole('button', { name: 'Add music.wav to timeline' }));
    await waitFor(() => expect(screen.getByText(/Preview: clip\.mp4/)).toBeTruthy());
    expect(document.querySelector('video')).toBeTruthy();
  });

  it('edits animations, transitions and audio gain and saves them', async () => {
    const composition = {
      composition: {
        id: 'c2',
        projectId: 'p1',
        schemaVersion: 2,
        revision: 3,
        tracks: [
          { trackId: 'video-1', name: 'Main', type: 'video', order: 0, muted: false, hidden: false, locked: false, volume: 1 },
          { trackId: 'text-1', name: 'Titles', type: 'text', order: 1, muted: false, hidden: false, locked: false, volume: 1 },
          { trackId: 'audio-1', name: 'Music', type: 'audio', order: 2, muted: false, hidden: false, locked: false, volume: 0.6 },
        ],
        clips: [
          { id: 'v1', assetId: 'a1', trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 0, sourceOutSeconds: 3, durationSeconds: 3, order: 0, transitionIn: null, audio: null, text: null },
          {
            id: 'v2',
            assetId: 'a1',
            trackId: 'video-1',
            trackType: 'video',
            timelineStartSeconds: 3,
            sourceInSeconds: 3,
            sourceOutSeconds: 6,
            durationSeconds: 3,
            order: 1,
            transitionIn: { type: 'crossfade', durationSeconds: 1 },
            audio: null,
            text: null,
          },
          {
            id: 't1',
            assetId: null,
            trackId: 'text-1',
            trackType: 'text',
            timelineStartSeconds: 3.2,
            sourceInSeconds: 0,
            sourceOutSeconds: 0,
            durationSeconds: 2,
            order: 0,
            transitionIn: null,
            audio: null,
            text: {
              content: 'Zoom title',
              x: 0.5,
              y: 0.4,
              width: 0.8,
              alignment: 'center',
              fontFamily: 'sans',
              fontSize: 48,
              fontColor: '#ffffff',
              backgroundColor: '#000000',
              backgroundOpacity: 0,
              textOpacity: 1,
              bold: false,
              italic: false,
              shadow: false,
              outline: false,
              outlineColor: '#000000',
              outlineWidth: 2,
              zIndex: 1,
              animation: {
                version: 1,
                entrance: { type: 'zoom', durationSeconds: 0.6, delaySeconds: 0, easing: 'ease-out' },
                exit: null,
              },
            },
          },
          {
            id: 'a1c',
            assetId: 'a2',
            trackId: 'audio-1',
            trackType: 'audio',
            timelineStartSeconds: 0,
            sourceInSeconds: 0,
            sourceOutSeconds: 3,
            durationSeconds: 3,
            order: 0,
            transitionIn: null,
            audio: { volume: 0.5, fadeInSeconds: 0.5, fadeOutSeconds: 0.5 },
            text: null,
          },
        ],
        updatedAt: null,
      },
    };
    vi.spyOn(api, 'get').mockImplementation((path) => {
      if (path === '/api/projects/p1') return Promise.resolve(project) as never;
      if (path === '/api/video-render/tools') return Promise.resolve(availableTools) as never;
      if (path === '/api/projects/p1/assets') {
        return Promise.resolve([
          { id: 'a1', name: 'clip.mp4', type: 'video', fileUrl: '/api/assets/a1/file', mimeType: 'video/mp4', sourceDurationSeconds: 12 },
          { id: 'a2', name: 'music.wav', type: 'audio', fileUrl: '/api/assets/a2/file', mimeType: 'audio/wav', sourceDurationSeconds: 12 },
        ]) as never;
      }
      if (path === '/api/projects/p1/composition') return Promise.resolve(composition) as never;
      return Promise.resolve({}) as never;
    });
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    const put = vi.spyOn(api, 'putWithHeaders').mockImplementation((_path, body) =>
      Promise.resolve({ composition: { ...composition.composition, revision: 4, clips: (body as never as { clips: never[] }).clips } }) as never
    );

    renderEditor();
    await screen.findByText('clip.mp4');
    await waitFor(() => expect(document.querySelector('[data-transition-marker="crossfade"]')).toBeTruthy());
    expect(document.querySelector('[data-animation-region="t1"]')).toBeTruthy();
    expect(document.querySelector('[data-audio-envelope="a1c"]')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Timeline playhead'), { target: { value: '3.2' } });
    await waitFor(() => {
      const overlay = document.querySelector('[data-preview-text="t1"]') as HTMLElement;
      expect(overlay).toBeTruthy();
      expect(Number(overlay.dataset.previewScale)).toBeCloseTo(0.55, 2);
    });

    fireEvent.pointerDown(document.querySelector('button[title^="Zoom title ·"]') as HTMLElement, { button: 0, clientX: 0 });
    const entrance = (await screen.findByLabelText('entrance animation')) as HTMLSelectElement;
    expect(entrance.value).toBe('zoom');
    fireEvent.change(entrance, { target: { value: 'slide-left' } });
    await waitFor(() => {
      const overlay = document.querySelector('[data-preview-text="t1"]') as HTMLElement;
      expect(overlay.style.transform).toContain('translate(-1280.0px');
      expect(overlay.dataset.previewScale).toBe('1.000');
    });

    fireEvent.pointerDown(document.querySelector('button[title^="music.wav ·"]') as HTMLElement, { button: 0, clientX: 0 });
    fireEvent.change(await screen.findByLabelText('Clip volume'), { target: { value: '0.9' } });

    fireEvent.click(screen.getByRole('button', { name: 'Save composition' }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    const savedBody = put.mock.calls[0][1] as {
      tracks: Array<{ trackId: string; volume: number }>;
      clips: Array<{ trackType: string; transitionIn: unknown; audio: { volume: number } | null; text: { animation: { entrance: { type: string } } } | null }>;
    };
    expect(savedBody.tracks.find((track) => track.trackId === 'audio-1')?.volume).toBe(0.6);
    expect(savedBody.clips.find((clip) => clip.trackType === 'video' && clip.transitionIn)?.transitionIn).toEqual({
      type: 'crossfade',
      durationSeconds: 1,
    });
    expect(savedBody.clips.find((clip) => clip.trackType === 'text')?.text?.animation.entrance.type).toBe('slide-left');
    expect(savedBody.clips.find((clip) => clip.trackType === 'audio')?.audio?.volume).toBe(0.9);
  });

  it('disables rendering and explains when local FFmpeg is unavailable', async () => {
    mockApi(unavailableTools);
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    renderEditor();
    expect(await screen.findByText('MP4 rendering is unavailable on this server.')).toBeTruthy();
    expect(screen.getByText(/Set FFMPEG_PATH/)).toBeTruthy();
    const renderButton = screen.getByRole('button', { name: 'Render MP4' });
    expect(renderButton.hasAttribute('disabled')).toBe(true);
  });

  it('surfaces API errors instead of showing a successful editor', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Project access denied'));
    renderEditor();
    await waitFor(() => expect(screen.getByText('Project access denied')).toBeTruthy());
  });
});
