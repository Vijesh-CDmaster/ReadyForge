import { VideoJobMode } from '../models/GenerationTask';
import {
  VideoProvider,
  VideoProviderRequest,
  VideoProviderStatusResult,
} from './videoProvider';

export type MockVideoRequest = {
  projectTitle: string;
  contractVersion: number;
  mode: VideoJobMode;
};

export type MockVideoProgress = (progress: number, stage: string) => Promise<void>;

export class MockProviderError extends Error {
  constructor(
    message: string,
    readonly code: 'MOCK_RETRYABLE' | 'MOCK_PERMANENT' | 'MOCK_TIMEOUT',
    readonly retryable: boolean
  ) {
    super(message);
  }
}

export class MockVideoProvider implements VideoProvider {
  readonly id = 'mock';

  async submit(request: VideoProviderRequest): Promise<{ providerJobId: string; status: 'submitted'; estimatedCost: number; currency: string }> {
    return {
      providerJobId: `mock-${request.correlationId}`,
      status: 'submitted',
      estimatedCost: 0,
      currency: 'INR',
    };
  }

  async getStatus(_providerJobId: string): Promise<VideoProviderStatusResult> {
    return { providerJobId: _providerJobId, status: 'succeeded', progress: 100 };
  }

  async estimateCost(_request: VideoProviderRequest) {
    return { amount: 0, currency: 'INR' };
  }
}

export async function generateMockVideo(
  request: MockVideoRequest,
  onProgress: MockVideoProgress
): Promise<{ outputText: string; model: string }> {
  const stages = [
    [10, 'validating contract'],
    [45, 'rendering mock storyboard'],
    [80, 'packaging mock result'],
  ] as const;

  for (const [progress, stage] of stages) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await onProgress(progress, stage);
  }

  if (request.mode === 'retryable_failure') {
    throw new MockProviderError('Mock provider temporary failure.', 'MOCK_RETRYABLE', true);
  }
  if (request.mode === 'permanent_failure') {
    throw new MockProviderError('Mock provider rejected the request.', 'MOCK_PERMANENT', false);
  }
  if (request.mode === 'timeout') {
    throw new MockProviderError('Mock provider timed out.', 'MOCK_TIMEOUT', true);
  }

  return {
    outputText:
      `[MOCK OUTPUT — NOT A PLAYABLE MP4]\n` +
      `Deterministic video-generation result for "${request.projectTitle}".\n` +
      `Production Contract version: ${request.contractVersion}.\n` +
      `This artifact is not approved production output.`,
    model: 'readyforge-mock-video',
  };
}
