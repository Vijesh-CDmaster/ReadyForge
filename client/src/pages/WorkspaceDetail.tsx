import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Trash2, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  SectionTitle,
  Select,
  Tabs,
} from '../components/ui';
import { StatusBadge, ReadinessMeter } from '../components/widgets';
import { PendingInvitations, OwnershipTransferCard } from '../components/InvitationsPanel';
import { toast } from '../store/toast';

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: string;
  status: string;
}
interface WorkspaceDetailPayload {
  id: string;
  name: string;
  description: string;
  ownerId: string;
  role: string;
  settings: { defaultCurrency: string; budgetApprovalThreshold: number; aiProviders: string[] };
  members: Member[];
  projects: Array<{
    id: string;
    title: string;
    status: string;
    mode: string;
    projectType: string;
    readinessScore: number;
    currentStage: string;
    updatedAt: string;
  }>;
}

const ROLE_OPTIONS = [
  ['lead', 'Lead — manage project & approvals'],
  ['writer', 'Writer — scripts & content'],
  ['designer', 'Designer — visual assets'],
  ['subject_matter_expert', 'Subject-matter expert — approved facts'],
  ['reviewer', 'Reviewer — approvals'],
  ['legal_reviewer', 'Legal reviewer — claims & rights'],
  ['finance_owner', 'Finance owner — budget decisions'],
  ['marketing_strategist', 'Marketing strategist — audience & campaign direction'],
  ['viewer', 'Viewer — read only'],
] as const;

export default function WorkspaceDetail() {
  const { workspaceId = '' } = useParams();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('overview');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('writer');
  const [inviteResult, setInviteResult] = useState<{ inviteUrl?: string; delivery?: { delivered: boolean; note?: string } } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<WorkspaceDetailPayload>(`/api/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const invite = useMutation({
    mutationFn: (vars: { email: string; role: string }) =>
      api.post<{ inviteUrl?: string; delivery?: { delivered: boolean; note?: string } }>(
        `/api/workspaces/${workspaceId}/invitations`,
        vars
      ),
    onSuccess: (res) => {
      setInviteResult(res);
      if (res.inviteUrl) {
        void navigator.clipboard?.writeText(res.inviteUrl).catch(() => undefined);
        toast.success('Invitation created — link copied (no email provider configured)');
      } else {
        toast.success('Invitation created');
      }
      setInviteEmail('');
      void queryClient.invalidateQueries({ queryKey: ['invitations', workspaceId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const changeRole = useMutation({
    mutationFn: (vars: { userId: string; role: string }) =>
      api.patch(`/api/workspaces/${workspaceId}/members/${vars.userId}`, { role: vars.role }),
    onSuccess: () => {
      toast.success('Role updated');
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    },
    onError: (err) => toast.error(err.message),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => api.del(`/api/workspaces/${workspaceId}/members/${userId}`),
    onSuccess: () => {
      toast.success('Member removed');
      void queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading workspace…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const isOwner = data.role === 'owner';

  return (
    <div className="mx-auto max-w-5xl">
      <SectionTitle
        title={data.name}
        subtitle={data.description || 'No description'}
        action={
          <div className="flex items-center gap-2">
            <Badge tone="brand">{data.role}</Badge>
            <Badge tone="neutral">{data.members.length} members</Badge>
            {tab === 'members' && (
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <UserPlus className="h-3.5 w-3.5" /> Invite
              </Button>
            )}
          </div>
        }
      />

      <Tabs
        active={tab}
        onChange={setTab}
        items={[
          { key: 'overview', label: 'Overview' },
          { key: 'members', label: `Members (${data.members.length})` },
          { key: 'settings', label: 'Settings' },
        ]}
        className="mb-5"
      />

      {tab === 'overview' && (
        <div>
          <div className="mb-5 grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-slate-500">Projects</p>
              <p className="text-2xl font-bold">{data.projects.length}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Currency</p>
              <p className="text-2xl font-bold">{data.settings.defaultCurrency}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-slate-500">Budget approval threshold</p>
              <p className="text-2xl font-bold tabular-nums">{data.settings.budgetApprovalThreshold}</p>
            </Card>
          </div>

          {data.projects.length === 0 ? (
            <Card className="p-8 text-center text-sm text-slate-500">
              No projects yet.{' '}
              <Link to="/app/projects/new" className="font-medium text-brand-600 hover:underline">
                Create one
              </Link>
            </Card>
          ) : (
            <div className="grid gap-4 lg:grid-cols-2">
              {data.projects.map((p) => (
                <Link key={p.id} to={`/app/projects/${p.id}`}>
                  <Card className="p-5 transition hover:border-brand-400">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold">{p.title}</h3>
                        <p className="text-xs text-slate-500">
                          {p.mode} · {p.projectType.replace('_', ' ')}
                        </p>
                      </div>
                      <StatusBadge status={p.status} />
                    </div>
                    <div className="mt-3">
                      <ReadinessMeter score={p.readinessScore} compact />
                    </div>
                  </Card>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'members' && (
        <Card className="divide-y divide-slate-200 dark:divide-slate-800">
          {data.members.map((m) => (
            <div key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Avatar name={m.name} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{m.name}</p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
              <Select
                className="w-56"
                value={m.role}
                disabled={!isOwner || m.userId === data.ownerId}
                onChange={(e) => changeRole.mutate({ userId: m.userId, role: e.target.value })}
              >
                <option value="owner">Owner</option>
                {ROLE_OPTIONS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
              {isOwner && m.userId !== data.ownerId && (
                <Button
                  variant="ghost"
                  size="sm"
                  title="Remove member"
                  onClick={() => {
                    if (confirm(`Remove ${m.name} from this workspace?`)) removeMember.mutate(m.userId);
                  }}
                >
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
              )}
            </div>
          ))}
          <div className="px-4 py-3 text-xs text-slate-500">
            Invitations expire after 7 days, can be resent (which rotates the link) and revoked at any time.
          </div>
        </Card>
      )}

      {tab === 'members' && isOwner && <PendingInvitations workspaceId={workspaceId} />}

      {tab === 'settings' && (
        <Card className="p-6">
          <dl className="space-y-3 text-sm">
            <Row label="Workspace ID" value={data.id} />
            <Row label="Owner" value={data.members.find((m) => m.userId === data.ownerId)?.name || data.ownerId} />
            <Row label="Default currency" value={data.settings.defaultCurrency} />
            <Row label="Budget approval threshold" value={String(data.settings.budgetApprovalThreshold)} />
            <Row label="AI providers" value={data.settings.aiProviders.join(', ') || '—'} />
          </dl>
          {!isOwner && (
            <p className="mt-4 text-xs text-slate-500">Only the workspace owner can change these settings.</p>
          )}
        </Card>
      )}

      {tab === 'settings' && (
        <OwnershipTransferCard
          workspaceId={workspaceId}
          members={data.members}
          ownerId={data.ownerId}
          isOwner={isOwner}
        />
      )}

      <Modal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite member"
        footer={
          <>
            <Button variant="ghost" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button loading={invite.isPending} onClick={() => { setInviteResult(null); invite.mutate({ email: inviteEmail, role: inviteRole }); }}>
              Create invitation
            </Button>
          </>
        }
      >
        <p className="mb-4 flex items-center gap-2 text-sm text-slate-500">
          <Mail className="h-4 w-4" /> {inviteResult?.delivery?.note || 'Sends an expiring invitation link — the recipient accepts or declines it.'}
        </p>
        {inviteResult?.inviteUrl && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-1 font-medium">Invitation link (development fallback — not emailed)</p>
            <code className="block break-all text-brand-600">{inviteResult.inviteUrl}</code>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => {
                void navigator.clipboard?.writeText(inviteResult.inviteUrl!).catch(() => undefined);
                toast.success('Link copied');
              }}
            >
              Copy link
            </Button>
          </div>
        )}
        <Field label="Email">
          <Input id="invite-email" placeholder="lead@readyforge.ai" value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select value={inviteRole} onChange={(e) => setInviteRole(e.target.value)}>
            <option value="lead">Lead</option>
            <option value="writer">Writer</option>
            <option value="designer">Designer</option>
            <option value="subject_matter_expert">Subject-matter expert</option>
            <option value="reviewer">Reviewer</option>
            <option value="legal_reviewer">Legal reviewer</option>
            <option value="finance_owner">Finance owner</option>
            <option value="viewer">Viewer</option>
          </Select>
        </Field>
      </Modal>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 pb-2 dark:border-slate-800">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
