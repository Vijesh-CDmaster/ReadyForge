import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { config } from './config';
import { connectDb } from './db';
import { errorHandler, requestId } from './http';
import { isDbReady } from './db';
import { authRouter } from './routes/auth';
import { workspacesRouter } from './routes/workspaces';
import { invitationsRouter } from './routes/invitations';
import { templatesRouter } from './routes/templates';
import { projectsRouter } from './routes/projects';
import { inputsRouter } from './routes/inputs';
import { conflictsRouter } from './routes/conflicts';
import { assetsRouter } from './routes/assets';
import { aiRouter } from './routes/ai';
import { notificationsRouter } from './routes/notifications';
import { generationRouter } from './routes/generation';
import { analyticsRouter } from './routes/analytics';
import { intelligenceRouter } from './routes/intelligence';
import { tasteRouter } from './routes/taste';
import { commentsRouter } from './routes/comments';
import { adminRouter } from './routes/admin';
import { VideoJobWorker } from './services/videoJobs';

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
  app.use(requestId);

  app.get('/api/health', (_req, res) =>
    res.json({ ok: true, service: 'readyforge-api', ai: Boolean(config.ai.apiKey), time: new Date().toISOString() })
  );
  app.get('/api/ready', (_req, res) => {
    const ready = isDbReady();
    res.status(ready ? 200 : 503).json({
      ok: ready,
      service: 'readyforge-api',
      database: ready ? 'ready' : 'unavailable',
      time: new Date().toISOString(),
    });
  });

  /*
   * Unknown endpoints must answer 404, not fall into router-level auth (which
   * would answer 401 for every typo'd path). We record the first path segment
   * of every registered route and reject anything else up front.
   */
  const knownRoots = new Set<string>();
  const mount = (prefix: string, router: express.Router) => {
    const stack = (router as unknown as { stack: Array<{ route?: { path: string | string[] } }> }).stack;
    for (const layer of stack) {
      if (!layer.route) continue;
      const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
      for (const p of paths) {
        const segs = String(p).split('/').filter(Boolean);
        const first = segs[0] && !segs[0].startsWith(':') ? `/${segs[0]}` : '';
        knownRoots.add(`${prefix}${first}`.replace(/\/+$/, '') || '/');
      }
    }
    app.use(prefix, router);
  };

  app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) return next();
    const path = req.path.replace(/\/+$/, '') || '/api';
    for (const root of knownRoots) {
      if (path === root || path.startsWith(`${root}/`)) return next();
    }
    res.status(404).json({ error: 'Endpoint not found' });
  });

  mount('/api/auth', authRouter);
  mount('/api/workspaces', workspacesRouter);
  mount('/api', invitationsRouter);
  mount('/api', templatesRouter);
  mount('/api/projects', projectsRouter);
  mount('/api', inputsRouter);
  mount('/api', conflictsRouter);
  mount('/api', assetsRouter);
  mount('/api/ai', aiRouter);
  mount('/api/notifications', notificationsRouter);
  mount('/api', generationRouter);
  mount('/api', analyticsRouter);
  mount('/api', intelligenceRouter);
  mount('/api/taste', tasteRouter);
  mount('/api', commentsRouter);
  mount('/api/admin', adminRouter);

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
  const worker = new VideoJobWorker();
  worker.start();
  const server = await new Promise<import('node:http').Server>((resolve, reject) => {
    const instance = app.listen(config.port, () => resolve(instance));
    instance.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`[startup] Port ${config.port} is already in use. Stop the existing API or set PORT to another value.`);
      }
      reject(err);
    });
  });
  console.log(`[api] ReadyForge API on http://localhost:${config.port}`);
  console.log(`[ai]  provider: ${config.ai.apiKey ? `${config.ai.baseUrl} (${config.ai.model})` : 'rule engine (set OPENAI_API_KEY to enable LLM calls)'}`);
  const shutdown = () => {
    void worker.stop().finally(() => server.close());
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
