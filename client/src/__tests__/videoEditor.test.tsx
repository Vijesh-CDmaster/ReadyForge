import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
    vi.spyOn(api, 'get').mockImplementation((path) => {
      if (path === '/api/projects/p1') return Promise.resolve(project) as never;
      if (path === '/api/projects/p1/assets') return Promise.resolve([]) as never;
      return Promise.resolve({ composition: { id: null, projectId: 'p1', schemaVersion: 1, revision: 0, clips: [], updatedAt: null } }) as never;
    });
    renderEditor();
    expect(await screen.findByText('No media assets')).toBeTruthy();
    expect(screen.getByText(/Rendering is not available yet/)).toBeTruthy();
  });

  it('renders populated assets and clip properties', async () => {
    vi.spyOn(api, 'get').mockImplementation((path) => {
      if (path === '/api/projects/p1') return Promise.resolve(project) as never;
      if (path === '/api/projects/p1/assets') {
        return Promise.resolve([{ id: 'a1', name: 'clip.mp4', type: 'video', fileUrl: '/api/assets/a1/file', mimeType: 'video/mp4', sourceDurationSeconds: 12 }]) as never;
      }
      return Promise.resolve({
        composition: {
          id: 'c1',
          projectId: 'p1',
          schemaVersion: 1,
          revision: 2,
          clips: [{ id: 'clip1', assetId: 'a1', trackId: 'video-1', trackType: 'video', timelineStartSeconds: 0, sourceInSeconds: 1, sourceOutSeconds: 5, durationSeconds: 4 }],
          updatedAt: null,
        },
      }) as never;
    });
    vi.spyOn(api, 'getBlob').mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
    renderEditor();
    expect(await screen.findByText('clip.mp4')).toBeTruthy();
    expect(screen.getByText('Clip properties')).toBeTruthy();
    expect(screen.getByDisplayValue('1')).toBeTruthy();
  });

  it('surfaces API errors instead of showing a successful editor', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('Project access denied'));
    renderEditor();
    await waitFor(() => expect(screen.getByText('Project access denied')).toBeTruthy());
  });
});
