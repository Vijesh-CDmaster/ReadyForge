import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';
import { z, ZodTypeAny } from 'zod';
import { config } from './config';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

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

export function requestId(req: Request, _res: Response, next: () => void) {
  const supplied = req.header('x-request-id');
  req.requestId = supplied && /^[A-Za-z0-9._-]{1,80}$/.test(supplied) ? supplied : `rf-${randomUUID()}`;
  next();
}

function response(res: Response, status: number, error: string, requestId: string, details?: unknown) {
  res.setHeader('X-Request-Id', requestId);
  return res.status(status).json({ error, requestId, ...(details === undefined ? {} : { details }) });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: any) {
  const id = req.requestId || `rf-${randomUUID()}`;
  if (err instanceof ApiError) {
    return response(res, err.status, err.message, id, err.details);
  }
  const e = err as {
    code?: number | string;
    name?: string;
    message?: string;
    status?: number;
    statusCode?: number;
  };
  if (e?.code === 11000) {
    return response(res, 409, 'Duplicate value — record already exists.', id);
  }
  if (e?.name === 'CastError') {
    return response(res, 400, 'Invalid id format.', id);
  }
  // Optimistic-concurrency conflict (Workspace uses `optimisticConcurrency`):
  // another writer won the race — safe to tell the client to retry.
  if (e?.name === 'VersionError') {
    return response(res, 409, 'Record was modified concurrently — please retry.', id);
  }
  // Multer upload errors: oversize → 413, anything else → 400. Never a 500.
  if (e?.name === 'MulterError') {
    const tooLarge = e.code === 'LIMIT_FILE_SIZE';
    return response(
      res,
      tooLarge ? 413 : 400,
      tooLarge
        ? `File exceeds the ${config.upload.maxMb}MB upload limit.`
        : `Upload failed: ${String(e.code || 'unknown error')}`,
      id
    );
  }
  // Body-parser / JSON syntax errors carry status 400 — honour any 4xx the
  // underlying library already decided instead of turning it into a 500.
  const libStatus = e?.status ?? e?.statusCode;
  if (typeof libStatus === 'number' && libStatus >= 400 && libStatus < 500) {
    return response(res, libStatus, e.message || 'Invalid request', id);
  }
  if (e?.name === 'MongoServerSelectionError' || e?.name === 'MongoNetworkError' || e?.name === 'MongooseServerSelectionError') {
    console.error(`[error ${id}] database unavailable`, err);
    return response(res, 503, 'Database temporarily unavailable. Please try again.', id);
  }
  console.error(`[error ${id}]`, err);
  // Never echo internal error messages: they can contain connection strings,
  // credentials or stack fragments. Details stay in the server log.
  return response(res, 500, 'Internal server error', id);
}
