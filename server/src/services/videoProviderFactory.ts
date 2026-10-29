import { config } from '../config';
import { MockVideoProvider } from './mockVideoProvider';
import { RunwayVideoProvider } from './runwayVideoProvider';
import { VideoProvider } from './videoProvider';

export function getVideoProvider(): VideoProvider {
  if (config.video.provider === 'mock') return new MockVideoProvider();
  if (config.video.provider === 'runway') return new RunwayVideoProvider();
  throw new Error(`Unsupported VIDEO_PROVIDER: ${config.video.provider}`);
}
