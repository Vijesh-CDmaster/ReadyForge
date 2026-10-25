import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, FolderKanban, Users, AlertTriangle, ArrowRight, Flame } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Card, EmptyState, SkeletonCard, SectionTitle, Badge, ErrorBox } from '../components/ui';
import { StatusBadge, ReadinessMeter } from '../components/widgets';
import { toast } from '../store/toast';

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  mode: string;
  projectType: string;
  readinessScore: number;
  currentStage: string;
  workspaceId: string;
  workspaceName: string;
  budget: { amount: number; currency: string; remaining: number };
  updatedAt: string;
}

export default function Dashboard() {
  const { user, workspaces } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: projects, isLoading, error } = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects'),
  });

  // Judge Mode: one click loads a deliberately risky campaign to demo the gates.
  const judgeMode = useMutation({
    mutationFn: () => {
      const wsId = workspaces[0]?.id;
      if (!wsId) throw new Error('Create a workspace first');
      return api.post<{ projectId: string; conflictsCreated: number; risk: { score: number } }>(
        `/api/workspaces/${wsId}/judge-mode`
      );
    },
    onSuccess: (res) => {
      toast.success(`Risky campaign loaded — ${res.conflictsCreated} conflict(s), risk score ${res.risk.score}`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate(`/app/projects/${res.projectId}/risk`);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading)
    return (
      <div className="mx-auto max-w-6xl" aria-busy="true" aria-label="Loading dashboard">
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );

  const blocked = (projects || []).filter((p) => p.status === 'blocked' || p.readinessScore < 50);
  const ready = (projects || []).filter((p) => p.status === 'ready' || p.readinessScore >= 75);

  return (
    <div className="mx-auto max-w-6xl">
      <SectionTitle
        title={`Welcome${user ? `, ${user.name.split(' ')[0]}` : ''}`}
        subtitle="Do not generate until the project is ready."
        action={
          <div className="flex gap-2">
            <Button
              variant="danger"
              size="sm"
              loading={judgeMode.isPending}
              onClick={() => judgeMode.mutate()}
              title="Loads a demo campaign with conflicting prices, an unsupported claim and an unlicensed track"
            >
              <Flame className="h-3.5 w-3.5" /> Simulate Risky Campaign
            </Button>
            <Link to="/app/workspaces/new">
              <Button variant="outline" size="sm">
                <Users className="h-3.5 w-3.5" /> New workspace
              </Button>
            </Link>
            <Link to="/app/projects/new">
              <Button size="sm">
                <Plus className="h-3.5 w-3.5" /> New project
              </Button>
            </Link>
          </div>
        }
      />

      {error && <ErrorBox error={error} className="mb-4" />}

      {/* KPI strip — only metrics backed by real project data */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label="Projects" value={projects?.length ?? 0} icon={<FolderKanban className="h-4 w-4" />} />
        <Kpi label="Ready to generate" value={ready.length} icon={<ArrowRight className="h-4 w-4" />} tone="success" />
        <Kpi label="Needs attention" value={blocked.length} icon={<AlertTriangle className="h-4 w-4" />} tone="danger" />
      </div>

      {/* What is preventing production? → direct path to each project's blockers */}
      {blocked.length > 0 && (
        <Card className="mb-6 border-rose-200 p-4 dark:border-rose-900/60">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-rose-500" aria-hidden />
            <h2 className="text-sm font-semibold">Blocking production</h2>
            <Badge tone="danger">{blocked.length} project{blocked.length === 1 ? '' : 's'}</Badge>
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {blocked.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <Link to={`/app/projects/${p.id}`} className="block truncate text-sm font-medium hover:text-brand-600 dark:hover:text-brand-300">
                    {p.title}
                  </Link>
                  <p className="truncate text-xs text-slate-500">
                    {p.status === 'blocked' ? 'Status: blocked' : `Readiness ${Math.round(p.readinessScore)}/100`} · stage {p.currentStage}
                  </p>
                </div>
                <Link to={`/app/projects/${p.id}/readiness`} className="shrink-0">
                  <Button variant="outline" size="sm">Review blockers</Button>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Workspaces */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((ws) => (
          <Link key={ws.id} to={`/app/workspaces/${ws.id}`}>
            <Card className="p-4 transition hover:border-brand-400">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{ws.name}</h3>
                <Badge tone="brand">{ws.role}</Badge>
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-slate-500">{ws.description || 'No description'}</p>
            </Card>
          </Link>
        ))}
        <Link to="/app/workspaces/new">
          <Card className="flex h-full min-h-24 items-center justify-center border-dashed p-4 text-sm text-slate-500 transition hover:border-brand-400 hover:text-brand-600">
            + Create workspace
          </Card>
        </Link>
      </div>

      {/* Projects */}
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">Projects</h2>
      {!projects?.length ? (
        <EmptyState
          icon={<FolderKanban className="h-8 w-8" />}
          title="No projects yet"
          description="Create a project to start collecting inputs, detecting conflicts and building a Production Contract."
          action={
            <Link to="/app/projects/new">
              <Button>
                <Plus className="h-4 w-4" /> Create your first project
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => (
            <Link key={p.id} to={`/app/projects/${p.id}`}>
              <Card className="p-4 transition hover:border-brand-400">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">{p.title}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {p.workspaceName} · {p.projectType.replace('_', ' ')} · {p.mode} mode
                    </p>
                  </div>
                  <StatusBadge status={p.status} />
                </div>
                <div className="mt-3 flex items-center justify-between gap-4">
                  <ReadinessMeter score={p.readinessScore} compact />
                  <span className="text-xs text-slate-400">
                    {p.budget.currency} {p.budget.remaining.toLocaleString('en-IN')} left
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
                  <span>Stage: {p.currentStage}</span>
                  <span>Updated {timeAgo(p.updatedAt)}</span>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return 'just now';
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function Kpi({
  label,
  value,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: number;
  icon: React.ReactNode;
  tone?: 'brand' | 'success' | 'danger';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    danger: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  };
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      <div>
        <p className="text-xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-slate-500">{label}</p>
      </div>
    </Card>
  );
}
