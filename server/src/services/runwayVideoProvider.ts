import { config } from '../config';
import {
  VideoProvider,
  VideoProviderError,
  VideoProviderRequest,
  VideoProviderStatus,
  VideoProviderStatusResult,
} from './videoProvider';

type RunwayTask = {
  id: string;
  status?: string;
  progress?: number;
  output?: string[];
  failure?: string;
};

function mapStatus(status: string | undefined): VideoProviderStatus {
  switch (String(status).toUpperCase()) {
    case 'SUCCEEDED':
      return 'succeeded';
    case 'FAILED':
      return 'failed';
    case 'CANCELED':
    case 'CANCELLED':
      return 'cancelled';
    case 'RUNNING':
      return 'running';
    default:
      return 'submitted';
  }
}

function classifyResponse(status: number, message: string): VideoProviderError {
  if (status === 401 || status === 403) return new VideoProviderError('Runway authentication failed.', 'authentication', false);
  if (status === 408 || status === 504) return new VideoProviderError('Runway request timed out.', 'timeout', true, true);
  if (status === 409) return new VideoProviderError('Runway rejected the request as a conflict.', 'validation', false);
  if (status === 429) return new VideoProviderError('Runway rate limit reached.', 'rate_limit', true);
  if (status === 402 || status === 413) return new VideoProviderError('Runway quota or request-size limit reached.', 'quota', false);
  if (status >= 400 && status < 500) return new VideoProviderError('Runway rejected the request.', 'validation', false);
  return new VideoProviderError('Runway returned a provider error.', 'provider', true);
}

async function readJson(response: Response): Promise<RunwayTask> {
  const text = await response.text();
  let body: RunwayTask & { error?: string };
  try {
    body = JSON.parse(text) as RunwayTask & { error?: string };
  } catch {
    body = { id: '', error: 'Runway returned an invalid response.' };
  }
  if (!response.ok) throw classifyResponse(response.status, body.error || 'Runway request failed.');
  return body;
}

export class RunwayVideoProvider implements VideoProvider {
  readonly id = 'runway';

  private readonly headers = {
    Authorization: `Bearer ${config.video.runwayApiKey}`,
    'Content-Type': 'application/json',
    'X-Runway-Version': '2024-11-06',
  };

  async submit(request: VideoProviderRequest) {
    if (!config.video.runwayApiKey) {
      throw new VideoProviderError('Runway credentials are not configured.', 'authentication', false);
    }
    let response: Response;
    try {
      response = await fetch(`${config.video.runwayBaseUrl}/v1/text_to_video`, {
        method: 'POST',
        headers: { ...this.headers, 'X-Runway-Idempotency-Key': request.idempotencyKey },
        body: JSON.stringify({
          model: request.model,
          promptText: request.prompt,
          ratio: request.aspectRatio,
          duration: request.durationSeconds,
        }),
        signal: AbortSignal.timeout(config.video.requestTimeoutMs),
      });
    } catch (error) {
      throw new VideoProviderError('Runway submission could not be completed.', 'network', true, true);
    }
    const task = await readJson(response);
    if (!task.id) throw new VideoProviderError('Runway did not return a task identifier.', 'provider', true, true);
    return {
      providerJobId: task.id,
      status: mapStatus(task.status),
      estimatedCost: 0,
      currency: config.video.currency,
    };
  }

  async getStatus(providerJobId: string): Promise<VideoProviderStatusResult> {
    let response: Response;
    try {
      response = await fetch(`${config.video.runwayBaseUrl}/v1/tasks/${encodeURIComponent(providerJobId)}`, {
        headers: this.headers,
        signal: AbortSignal.timeout(config.video.requestTimeoutMs),
      });
    } catch {
      throw new VideoProviderError('Runway status polling failed.', 'network', true);
    }
    const task = await readJson(response);
    const status = mapStatus(task.status);
    return {
      providerJobId,
      status,
      progress: task.progress,
      outputUrl: status === 'succeeded' ? task.output?.[0] : undefined,
      error: status === 'failed' ? new VideoProviderError(task.failure || 'Runway generation failed.', 'provider', false) : undefined,
    };
  }

  async cancel(providerJobId: string): Promise<void> {
    try {
      const response = await fetch(`${config.video.runwayBaseUrl}/v1/tasks/${encodeURIComponent(providerJobId)}`, {
        method: 'DELETE',
        headers: this.headers,
        signal: AbortSignal.timeout(config.video.requestTimeoutMs),
      });
      if (!response.ok) await readJson(response);
    } catch (error) {
      if (error instanceof VideoProviderError) throw error;
      throw new VideoProviderError('Runway cancellation failed.', 'network', true);
    }
  }

  async estimateCost(_request: VideoProviderRequest) {
    if (config.video.runwayEstimatedCost <= 0) {
      throw new VideoProviderError(
        'RUNWAY_ESTIMATED_COST_USD must be configured before paid generation is enabled.',
        'validation',
        false
      );
    }
    return { amount: config.video.runwayEstimatedCost, currency: config.video.currency };
  }
}
