import { Response } from 'express';
import { z, ZodTypeAny } from 'zod';

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
  const e = err as { code?: number; name?: string; message?: string };
  if (e?.code === 11000) {
    return res.status(409).json({ error: 'Duplicate value — record already exists.' });
  }
  if (e?.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid id format.' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: e?.message || 'Internal server error' });
}
