import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Send, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorBox, Loading } from './ui';
import { toast } from '../store/toast';
import { useAuthStore } from '../store/auth';

export interface InvitationRow {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired' | 'cancelled';
  expiresAt: string;
  invitedBy?: string;
  resendCount: number;
  createdAt: string;
}

const STATUS_TONE: Record<InvitationRow['status'], 'success' | 'warning' | 'danger' | 'neutral'> = {
  pending: 'warning',
  accepted: 'success',
  rejected: 'neutral',
  revoked: 'neutral',
  expired: 'danger',
  cancelled: 'neutral',
};

/** Pending invitation management (owner/lead) — spec §6.2. */
export function PendingInvitations({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['invitations', workspaceId],
    queryFn: () => api.get<{ invitations: InvitationRow[] }>(`/api/workspaces/${workspaceId}/invitations`),
    enabled: Boolean(workspaceId),
    refetchOnWindowFocus: false,
  });

  const resend = useMutation({
    mutationFn: (invitationId: string) =>
      api.post<{ inviteUrl?: string }>(`/api/workspaces/${workspaceId}/invitations/${invitationId}/resend`),
    onSuccess: (res) => {
      toast.success(res.inviteUrl ? 'Invitation resent — copy the new link below' : 'Invitation resent');
      void queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
      if (res.inviteUrl) void navigator.clipboard?.writeText(res.inviteUrl).catch(() => undefined);
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: (invitationId: string) => api.del(`/api/workspaces/${workspaceId}/invitations/${invitationId}`),
    onSuccess: () => {
      toast.success('Invitation cancelled');
      setConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
    },
    onError: (err) => {
      setConfirmId(null);
      toast.error(err.message);
    },
  });

  if (isLoading) return <Loading label="Loading invitations…" />;
  if (error) return <ErrorBox error={error} />;

  const rows = data?.invitations ?? [];

  return (
    <Card className="mt-4">
      <div className="flex items-center justify-between px-4 pt-4">
        <h3 className="text-sm font-semibold">Invitations</h3>
        <Badge tone="neutral">{rows.filter((r) => r.status === 'pending').length} pending</Badge>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          title="No invitations yet"
          description="Invite a teammate by email — the link expires after 7 days and can be revoked at any time."
        />
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-800">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{r.email}</p>
                <p className="truncate text-xs text-slate-500">
                  {r.role.replace(/_/g, ' ')}
                  {r.invitedBy ? ` · invited by ${r.invitedBy}` : ''}
                  {r.resendCount > 0 ? ` · resent ${r.resendCount}×` : ''}
                </p>
              </div>
              <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              {r.status === 'pending' && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    title="Resend (rotates the link)"
                    loading={resend.isPending && resend.variables === r.id}
                    onClick={() => resend.mutate(r.id)}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" title="Cancel invitation" onClick={() => setConfirmId(r.id)}>
                    <XCircle className="h-3.5 w-3.5 text-rose-500" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirmId)}
        title="Cancel invitation?"
        message="The link stops working immediately. You can send a new invitation later."
        confirmLabel="Cancel invitation"
        danger
        loading={cancel.isPending}
        onConfirm={() => confirmId && cancel.mutate(confirmId)}
        onCancel={() => setConfirmId(null)}
      />
    </Card>
  );
}

interface MemberOption {
  id: string;
  userId: string;
  name: string;
  role: string;
}

interface PendingTransfer {
  toUserId: string;
  initiatedBy: string;
  toName: string;
  initiatedByName: string;
  expiresAt: string;
  expired: boolean;
}

/** Ownership transfer offer/accept UI (spec §6.2). */
export function OwnershipTransferCard({
  workspaceId,
  members,
  ownerId,
  isOwner,
}: {
  workspaceId: string;
  members: MemberOption[];
  ownerId: string;
  isOwner: boolean;
}) {
  const queryClient = useQueryClient();
  const currentUser = useAuthStore((s) => s.user);
  const [targetUserId, setTargetUserId] = useState('');

  const { data, error } = useQuery({
    queryKey: ['ownership-transfer', workspaceId],
    queryFn: () => api.get<{ pending: PendingTransfer | null }>(`/api/workspaces/${workspaceId}/ownership-transfer`),
    enabled: Boolean(workspaceId),
    refetchOnWindowFocus: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['ownership-transfer', workspaceId] });
    void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
  };

  const offer = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${workspaceId}/ownership-transfer`, { targetUserId }),
    onSuccess: () => {
      toast.success('Ownership offered — the member must accept');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const accept = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${workspaceId}/ownership-transfer/accept`),
    onSuccess: () => {
      toast.success('You are now the workspace owner');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const cancel = useMutation({
    mutationFn: () => api.post(`/api/workspaces/${workspaceId}/ownership-transfer/cancel`),
    onSuccess: () => {
      toast.success('Transfer cancelled');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const pending = data?.pending ?? null;
  const iAmTarget = Boolean(pending && currentUser && pending.toUserId === currentUser.id);
  const candidates = members.filter((m) => m.userId !== ownerId);

  if (error) return <ErrorBox error={error} className="mt-4" />;

  return (
    <Card className="mt-4 p-6">
      <h3 className="text-sm font-semibold">Ownership transfer</h3>
      <p className="mt-1 text-xs text-slate-500">
        The owner offers ownership; the recipient must accept. The previous owner becomes a lead, and the workspace
        always keeps exactly one owner.
      </p>

      {pending ? (
        <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950">
          <p>
            <strong>{pending.initiatedByName}</strong> offered ownership to <strong>{pending.toName}</strong>
            {pending.expired ? ' (expired)' : ` — expires ${new Date(pending.expiresAt).toLocaleString()}`}
          </p>
          <div className="mt-2 flex gap-2">
            {iAmTarget && !pending.expired && (
              <Button size="sm" loading={accept.isPending} onClick={() => accept.mutate()}>
                Accept ownership
              </Button>
            )}
            {isOwner && (
              <Button variant="ghost" size="sm" loading={cancel.isPending} onClick={() => cancel.mutate()}>
                Cancel offer
              </Button>
            )}
          </div>
        </div>
      ) : isOwner ? (
        candidates.length === 0 ? (
          <p className="mt-3 text-xs text-slate-500">
            Add at least one more member before transferring ownership.
          </p>
        ) : (
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className="flex-1">
              <span className="mb-1 block text-xs text-slate-500">Transfer to</span>
              <select
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-900"
                value={targetUserId}
                onChange={(e) => setTargetUserId(e.target.value)}
              >
                <option value="">Choose a member…</option>
                {candidates.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name} ({m.role.replace(/_/g, ' ')})
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="secondary"
              disabled={!targetUserId}
              loading={offer.isPending}
              onClick={() => offer.mutate()}
            >
              <Send className="h-3.5 w-3.5" /> Offer ownership
            </Button>
          </div>
        )
      ) : (
        <p className="mt-3 text-xs text-slate-500">Only the current owner can offer ownership.</p>
      )}
    </Card>
  );
}