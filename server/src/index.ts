import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { config } from './config';
import { connectDb } from './db';
import { errorHandler } from './http';
import { authRouter } from './routes/auth';
import { workspacesRouter } from './routes/workspaces';
import { projectsRouter } from './routes/projects';
import { inputsRouter } from './routes/inputs';
import { conflictsRouter } from './routes/conflicts';
import { assetsRouter } from './routes/assets';
import { aiRouter } from './routes/ai';
import { notificationsRouter } from './routes/notifications';
import { generationRouter } from './routes/generation';
import { analyticsRouter } from './routes/analytics';

export function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(
    cors({
      origin: config.corsOrigin.split(',').map((o) => o.trim()),
      credentials: true,
    })
  );
  app.use(express.json({ limit: '2mb' }));
  app.use(cookieParser());

  app.use('/uploads', express.static(path.resolve(config.upload.dir), { maxAge: '7d' }));

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, service: 'readyforge-api', ai: Boolean(config.ai.apiKey), time: new Date().toISOString() })
  );

  app.use('/api/auth', authRouter);
  app.use('/api/workspaces', workspacesRouter);
  app.use('/api/projects', projectsRouter);
  app.use('/api', inputsRouter);
  app.use('/api', conflictsRouter);
  app.use('/api', assetsRouter);
  app.use('/api/ai', aiRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api', generationRouter);
  app.use('/api', analyticsRouter);

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));
  app.use(errorHandler);
  return app;
}

async function main() {
  await connectDb();

  // Auto-seed a fresh database so the demo works end to end.
  if (process.env.SEED_ON_START !== 'false') {
    try {
      const { User } = await import('./models/User');
      const count = await User.countDocuments();
      if (count === 0) {
        const { seed } = await import('./seed');
        await seed();
      }
    } catch (err) {
      console.error('[seed] failed:', err);
    }
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`[api] ReadyForge API on http://localhost:${config.port}`);
    console.log(`[ai]  provider: ${config.ai.apiKey ? `${config.ai.baseUrl} (${config.ai.model})` : 'rule engine (set OPENAI_API_KEY to enable LLM calls)'}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
