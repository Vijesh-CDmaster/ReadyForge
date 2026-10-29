import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunwayVideoProvider } from '../services/runwayVideoProvider';

describe('RunwayVideoProvider', () => {
  afterEach(() => vi.restoreAllMocks());

  it('fails closed when credentials are missing', async () => {
    const provider = new RunwayVideoProvider();
    await expect(
      provider.submit({
        prompt: 'test',
        model: 'gen4.5',
        durationSeconds: 5,
        aspectRatio: '1280:720',
        correlationId: 'corr',
        idempotencyKey: 'key',
      })
    ).rejects.toMatchObject({ kind: 'authentication', retryable: false });
  });

  it('maps a rate limit response without exposing response details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'too many requests' }), {
          status: 429,
          headers: { 'content-type': 'application/json' },
        })
      )
    );
    const provider = new RunwayVideoProvider();
    const error = await provider.getStatus('provider-task').catch((value) => value);
    expect(error).toMatchObject({ kind: 'rate_limit', retryable: true });
    expect(error.message).toBe('Runway rate limit reached.');
  });

  it('marks a network submission failure as ambiguous and retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('socket closed')));
    const provider = new RunwayVideoProvider();
    const error = await provider.getStatus('provider-task').catch((value) => value);
    expect(error).toMatchObject({ kind: 'network', retryable: true, ambiguousSubmission: false });
  });
});
