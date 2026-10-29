export type VideoProviderStatus = 'submitted' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type VideoProviderErrorKind =
  | 'authentication'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'validation'
  | 'content_policy'
  | 'provider';

export type VideoProviderRequest = {
  prompt: string;
  model: string;
  durationSeconds: number;
  aspectRatio: string;
  correlationId: string;
  idempotencyKey: string;
};

export type VideoProviderSubmission = {
  providerJobId: string;
  status: VideoProviderStatus;
  estimatedCost: number;
  currency: string;
};

export type VideoProviderStatusResult = {
  providerJobId: string;
  status: VideoProviderStatus;
  progress?: number;
  outputUrl?: string;
  outputMimeType?: string;
  actualCost?: number;
  currency?: string;
  error?: VideoProviderError;
};

export class VideoProviderError extends Error {
  constructor(
    message: string,
    readonly kind: VideoProviderErrorKind,
    readonly retryable: boolean,
    readonly ambiguousSubmission = false
  ) {
    super(message);
    this.name = 'VideoProviderError';
  }
}

export interface VideoProvider {
  readonly id: string;
  submit(request: VideoProviderRequest): Promise<VideoProviderSubmission>;
  getStatus(providerJobId: string): Promise<VideoProviderStatusResult>;
  cancel?(providerJobId: string): Promise<void>;
  estimateCost(request: VideoProviderRequest): Promise<{ amount: number; currency: string }>;
}
