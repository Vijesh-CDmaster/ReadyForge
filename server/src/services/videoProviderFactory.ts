import { config } from '../config';
import { MockVideoProvider } from './mockVideoProvider';
import { RunwayVideoProvider } from './runwayVideoProvider';
import { VideoProvider } from './videoProvider';

export function getVideoProvider(providerId = config.video.provider): VideoProvider {
  if (providerId === 'mock') return new MockVideoProvider();
  if (providerId === 'runway') return new RunwayVideoProvider();
  throw new Error(`Unsupported VIDEO_PROVIDER: ${providerId}`);
}
