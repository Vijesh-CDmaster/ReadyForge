import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProtectedVideoPreview } from '../components/ProtectedVideoPreview';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({
  api: { getBlob: vi.fn() },
}));

const getBlob = vi.mocked(api.getBlob);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProtectedVideoPreview', () => {
  it('fetches a protected video blob and revokes its object URL on unmount', async () => {
    const objectUrl = 'blob:generated-video';
    const createObjectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue(objectUrl);
    const revokeObjectUrl = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    getBlob.mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));

    const rendered = render(<ProtectedVideoPreview assetId="asset-1" label="Generated video" />);
    await waitFor(() => expect(document.querySelector('video')).toBeTruthy());

    expect(getBlob).toHaveBeenCalledWith('/api/assets/asset-1/file');
    expect(createObjectUrl).toHaveBeenCalled();
    rendered.unmount();
    expect(revokeObjectUrl).toHaveBeenCalledWith(objectUrl);
  });

  it('does not present a non-video blob as playable media', async () => {
    getBlob.mockResolvedValue(new Blob(['not-video'], { type: 'text/plain' }));

    render(<ProtectedVideoPreview assetId="asset-2" label="Generated video" />);
    await waitFor(() => expect(screen.getByText('This asset is not a playable video.')).toBeTruthy());
    expect(document.querySelector('video')).toBeNull();
  });
});
