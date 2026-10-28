import { Response } from 'express';
import { z, ZodTypeAny } from 'zod';
import { config } from './config';

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const asyncHandler =
  <T extends (req: any, res: Response, next?: any) => Promise<unknown>>(fn: T) =>
  (req: any, res: Response, next: any) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function validateBody<S extends ZodTypeAny>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    throw new ApiError(400, `Validation failed — ${details.join('; ')}`, details);
  }
  return result.data as z.output<S>;
}

export function errorHandler(err: unknown, _req: any, res: Response, _next: any) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  const e = err as { code?: number | string; name?: string; message?: string; status?: number; statusCode?: number };
  if (e?.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value — record already exists.' });
  }
  if (e?.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid id format.' });
  }
  // Optimistic-concurrency conflict (Workspace uses `optimisticConcurrency`):
  // another writer won the race — safe to tell the client to retry.
  if (e?.name === 'VersionError') {
    return res.status(409).json({ error: 'Record was modified concurrently — please retry.' });
  }
  // Multer upload errors: oversize → 413, anything else → 400. Never a 500.
  if (e?.name === 'MulterError') {
    const tooLarge = e.code === 'LIMIT_FILE_SIZE';
    return res.status(tooLarge ? 413 : 400).json({
      error: tooLarge
        ? `File exceeds the ${config.upload.maxMb}MB upload limit.`
        : `Upload failed: ${String(e.code || 'unknown error')}`,
    });
  }
  // Body-parser / JSON syntax errors carry status 400 — honour any 4xx the
  // underlying library already decided instead of turning it into a 500.
  const libStatus = e?.status ?? e?.statusCode;
  if (typeof libStatus === 'number' && libStatus >= 400 && libStatus < 500) {
    return res.status(libStatus).json({ error: e.message || 'Invalid request' });
  }
  console.error('[error]', err);
  // Never echo internal error messages: they can contain connection strings,
  // credentials or stack fragments. Details stay in the server log.
  return res.status(500).json({ error: 'Internal server error' });
}
