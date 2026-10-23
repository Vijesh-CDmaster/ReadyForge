import { AuditLog } from './models/AuditLog';

interface AuditEntry {
  workspaceId?: string | null;
  projectId?: string | null;
  actorId?: string | null;
  actorType?: 'user' | 'ai' | 'system';
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}

/** Fire-and-forget audit logging — failures never break the request. */
export function audit(entry: AuditEntry): void {
  void AuditLog.create({
    workspaceId: entry.workspaceId || undefined,
    projectId: entry.projectId || undefined,
    actorId: entry.actorId || undefined,
    actorType: entry.actorType || 'user',
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId || undefined,
    before: entry.before,
    after: entry.after,
    metadata: entry.metadata,
    ipAddress: entry.ipAddress,
  }).catch((err) => console.error('[audit] failed:', err.message));
}

export function clientIp(req: { ip?: string; headers: Record<string, unknown>; socket?: { remoteAddress?: string } }): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}
