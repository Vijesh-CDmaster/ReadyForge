import 'dotenv/config';
import path from 'node:path';

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

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
  upload: {
    dir: path.resolve(__dirname, '..', 'uploads'),
    maxMb: num(process.env.MAX_UPLOAD_MB, 25),
  },
  dataDir: path.resolve(__dirname, '..', '.data'),
  isProd: process.env.NODE_ENV === 'production',
};

export const isAiConfigured = () => Boolean(config.ai.apiKey);
