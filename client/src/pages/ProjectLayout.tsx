import { Navigate, NavLink, Outlet, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { StatusBadge, ReadinessMeter } from '../components/widgets';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { cx } from '../components/ui';

export interface ProjectDetail {
  id: string;
  workspaceId: string;
  workspaceName: string;
  workspaceRole: string;
  title: string;
  description: string;
  projectType: string;
  status: string;
  mode: string;
  objective: string;
  audience: string;
  tone: string;
  callToAction: string;
  successMetric: string;
  deadline: string | null;
  budget: { amount: number; currency: string; spent: number; remaining: number };
  currentStage: string;
  readinessScore: number;
  costAtRisk?: { reworkProbability: number; estimatedLoss: number; reasons: string[] };
  inputCounts: Record<string, number>;
  latestContract: { id: string; version: number; status: string } | null;
  members: Array<{
    id: string;
    userId: string;
    projectRole: string;
    workspaceRole: string;
    responsibilities: string[];
    name: string;
    email: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

export function useProject() {
  const { projectId = '' } = useParams();
  return useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`),
    enabled: Boolean(projectId),
  });
}

export default function ProjectLayout() {
  const { projectId = '' } = useParams();
  const { data, isLoading, error } = useProject();

  if (isLoading) return <Loading label="Loading project…" />;
  if (error) return <div className="mx-auto max-w-4xl"><ErrorBox error={error} /></div>;
  if (!data) return <Navigate to="/app" replace />;

  const totalInputs = Object.values(data.inputCounts || {}).reduce((a, b) => a + b, 0);

  const base = `/app/projects/${projectId}`;
  // Grouped so 15 destinations stay scannable (UI_AUDIT plan #5).
  const tabGroups: Array<{ label: string; tabs: Array<{ to: string; label: string; end?: boolean }> }> = [
    {
      label: 'Knowledge',
      tabs: [
        { to: base, label: 'Overview', end: true },
        { to: `${base}/inputs`, label: 'AI wizard' },
        { to: `${base}/ledger`, label: `Ledger (${totalInputs})` },
      ],
    },
    {
      label: 'Governance',
      tabs: [
        { to: `${base}/conflicts`, label: 'Conflicts' },
        { to: `${base}/assets`, label: 'Assets' },
        { to: `${base}/rights`, label: 'Rights' },
      ],
    },
    {
      label: 'Readiness',
      tabs: [
        { to: `${base}/readiness`, label: 'Readiness' },
        { to: `${base}/risk`, label: 'Cost at Risk' },
        { to: `${base}/contract`, label: 'Contract' },
      ],
    },
    {
      label: 'Production',
      tabs: [
        { to: `${base}/ladder`, label: 'Draft ladder' },
        { to: `${base}/script`, label: 'Script' },
        { to: `${base}/storyboard`, label: 'Storyboard' },
        { to: `${base}/verification`, label: 'Verify' },
      ],
    },
    {
      label: 'Insights',
      tabs: [
        { to: `${base}/lab`, label: 'Campaign lab' },
        { to: `${base}/taste`, label: 'Taste' },
        { to: `${base}/provenance`, label: 'Provenance' },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{data.title}</h1>
            <StatusBadge status={data.status} />
            <Badge tone="neutral">{data.mode}</Badge>
            <Badge tone="neutral">{data.workspaceName}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Stage: <strong>{data.currentStage}</strong> · Budget {data.budget.currency}{' '}
            {data.budget.remaining.toLocaleString('en-IN')} remaining
          </p>
        </div>
        <div className="w-56">
          <ReadinessMeter score={data.readinessScore} compact />
        </div>
      </div>

      <nav className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800" aria-label="Project sections">
        {tabGroups.map((group, gi) => (
          <div key={group.label} className="flex items-center gap-1">
            {gi > 0 && <span className="mx-1 h-4 w-px shrink-0 bg-slate-200 dark:bg-slate-800" aria-hidden />}
            <span
              className="mr-1 hidden shrink-0 self-center text-[10px] font-semibold uppercase tracking-wider text-slate-400 xl:block"
              aria-hidden
            >
              {group.label}
            </span>
            {group.tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  cx(
                    'relative whitespace-nowrap rounded-t-md px-3 py-2 text-sm font-medium transition-colors',
                    isActive
                      ? 'text-brand-700 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-600 dark:text-brand-300'
                      : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
                  )
                }
              >
                {tab.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <ErrorBoundary area="this project page">
        <Outlet />
      </ErrorBoundary>
    </div>
  );
}
