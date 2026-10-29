import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

const isProd = process.env.NODE_ENV === 'production';

// Dev fallbacks keep local startup zero-config, but a production server must never
// sign tokens with a known public secret — refuse to boot instead.
if (isProd && (!process.env.JWT_ACCESS_SECRET || !process.env.JWT_REFRESH_SECRET)) {
  throw new Error(
    'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must both be set when NODE_ENV=production. ' +
      'Refusing to start with development fallback secrets. See .env.example.'
  );
}

export const config = {
  port: num(process.env.PORT, 4000),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  mongoUri: process.env.MONGODB_URI || '',
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: process.env.ACCESS_TOKEN_TTL || '15m',
    refreshTtlDays: num(process.env.REFRESH_TOKEN_TTL_DAYS, 7),
  },
  ai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    baseUrl: (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  // Local trained-model service (../ai-service, FastAPI). Empty = disabled.
  localAiUrl: (process.env.LOCAL_AI_URL || '').replace(/\/+$/, ''),
  video: {
    provider: process.env.VIDEO_PROVIDER || 'mock',
    runwayApiKey: process.env.RUNWAY_API_KEY || '',
    runwayBaseUrl: (process.env.RUNWAY_BASE_URL || 'https://api.dev.runwayml.com').replace(/\/+$/, ''),
    runwayModel: process.env.RUNWAY_MODEL || 'gen4.5',
    runwayEstimatedCost: num(process.env.RUNWAY_ESTIMATED_COST_USD, 0),
    currency: process.env.VIDEO_COST_CURRENCY || 'USD',
    maxCost: num(process.env.VIDEO_MAX_COST_USD, 0),
    requestTimeoutMs: num(process.env.VIDEO_PROVIDER_TIMEOUT_MS, 30_000),
    pollInitialMs: num(process.env.VIDEO_POLL_INITIAL_MS, 2_000),
    pollMaxMs: num(process.env.VIDEO_POLL_MAX_MS, 15_000),
  },
  upload: {
    dir: path.resolve(__dirname, '..', 'uploads'),
    maxMb: num(process.env.MAX_UPLOAD_MB, 25),
  },
  dataDir: path.resolve(__dirname, '..', '.data'),
  isProd,
};

export const isAiConfigured = () => Boolean(config.ai.apiKey);
