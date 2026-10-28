import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Loading } from '../components/ui';
import { toast } from '../store/toast';
import { useAuthStore } from '../store/auth';

interface InvitationDetails {
  id: string;
  workspaceName: string;
  workspaceDescription: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  invitedBy: string;
}

/**
 * Public landing page for /invite/:token.
 * The raw token lives ONLY in the URL path — it is never written to storage,
 * logs or analytics, and the server is re-validated on every action.
 */
export default function InvitePage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const { data, isLoading, error } = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => api.get<{ invitation: InvitationDetails }>(`/api/invitations/${token}`),
    enabled: Boolean(token),
    retry: false,
    refetchOnWindowFocus: false,
  });

  const accept = useMutation({
    mutationFn: () => api.post<{ workspaceId: string }>(`/api/invitations/${token}/accept`),
    onSuccess: (res) => {
      toast.success('Invitation accepted — welcome aboard');
      void queryClient.invalidateQueries();
      navigate(`/app/workspaces/${res.workspaceId}`, { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  const reject = useMutation({
    mutationFn: () => api.post(`/api/invitations/${token}/reject`),
    onSuccess: () => {
      toast.success('Invitation declined');
      navigate('/', { replace: true });
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Checking invitation…" />;
  if (error) {
    return (
      <Centered>
        <Card className="p-6 text-center">
          <h1 className="text-lg font-semibold">Invitation unavailable</h1>
          <p className="mt-2 text-sm text-slate-500">
            This link is invalid, already used, revoked or expired. Ask the workspace owner to send a new one.
          </p>
          <ErrorBox error={error} className="mt-4" />
          <Link to="/" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">
            Back to home
          </Link>
        </Card>
      </Centered>
    );
  }

  const inv = data?.invitation;
  if (!inv) return null;

  const isPending = inv.status === 'pending';
  const emailMatches = user && user.email.toLowerCase() === inv.email.toLowerCase();
  const returnTo = `/invite/${token}`;

  return (
    <Centered>
      <Card className="p-6">
        <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          ReadyForge invitation
        </div>

        <h1 className="text-xl font-bold">Join {inv.workspaceName}</h1>
        <p className="mt-1 text-sm text-slate-500">{inv.workspaceDescription || 'Workspace invitation'}</p>

        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Invited email</dt>
            <dd className="font-medium">{inv.email}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Role</dt>
            <dd className="font-medium">{inv.role.replace(/_/g, ' ')}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Invited by</dt>
            <dd className="font-medium">{inv.invitedBy}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Status</dt>
            <dd>
              <Badge tone={isPending ? 'warning' : inv.status === 'accepted' ? 'success' : 'neutral'}>
                {inv.status}
              </Badge>
            </dd>
          </div>
          {isPending && (
            <div className="flex justify-between gap-4">
              <dt className="text-slate-500">Expires</dt>
              <dd className="font-medium">{new Date(inv.expiresAt).toLocaleString()}</dd>
            </div>
          )}
        </dl>

        {!isPending ? (
          <p className="mt-5 rounded-lg bg-slate-100 p-3 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            {inv.status === 'accepted'
              ? 'This invitation has already been accepted. Sign in to open the workspace.'
              : `This invitation is ${inv.status} and can no longer be used.`}
          </p>
        ) : !user ? (
          <div className="mt-5">
            <p className="mb-3 text-sm text-slate-500">
              Sign in (or create an account) with <strong>{inv.email}</strong> to respond.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to="/login" state={{ from: returnTo }}>
                <Button>Sign in to accept</Button>
              </Link>
              <Link to="/register" state={{ from: returnTo }}>
                <Button variant="secondary">Create an account</Button>
              </Link>
            </div>
          </div>
        ) : !emailMatches ? (
          <div className="mt-5 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm dark:border-rose-800 dark:bg-rose-950">
            <p>
              You are signed in as <strong>{user.email}</strong>, but this invitation was issued to{' '}
              <strong>{inv.email}</strong>.
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={async () => {
                await logout();
                toast.success('Signed out — sign in as the invited account');
              }}
            >
              Sign out
            </Button>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap gap-2">
            <Button loading={accept.isPending} onClick={() => accept.mutate()}>
              <Mail className="h-4 w-4" /> Accept invitation
            </Button>
            <Button variant="ghost" loading={reject.isPending} onClick={() => reject.mutate()}>
              Decline
            </Button>
          </div>
        )}
      </Card>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}