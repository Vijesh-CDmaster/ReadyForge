import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, Rocket, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, Loading, SectionTitle, cx } from '../components/ui';

interface ProjectRow {
  id: string;
  title: string;
  status: string;
  readinessScore: number;
  currentStage: string;
  updatedAt: string;
}

interface ProjectDetailLite {
  id: string;
  title: string;
  inputCounts: Record<string, number>;
  latestContract: { id: string; version: number; status: string } | null;
}

interface TaskRow {
  id: string;
  taskType: string;
  stage: string | null;
  status: string;
  reviewStatus: string;
}

interface Step {
  key: string;
  label: string;
  detail: string;
  done: boolean;
  to: string;
}

/**
 * Guided product tour (spec §27.3) as a real-state checklist: every step reads
 * live data from the MVP loop instead of a fake progress animation.
 */
export default function GettingStarted() {
  const projects = useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<ProjectRow[]>('/api/projects'),
  });

  const focus = projects.data?.[0];
  const base = focus ? `/app/projects/${focus.id}` : '/app/projects/new';

  const detail = useQuery({
    queryKey: ['project', focus?.id],
    queryFn: () => api.get<ProjectDetailLite>(`/api/projects/${focus!.id}`),
    enabled: Boolean(focus),
  });
  const tasks = useQuery({
    queryKey: ['tasks', focus?.id],
    queryFn: () => api.get<TaskRow[]>(`/api/projects/${focus!.id}/tasks`),
    enabled: Boolean(focus),
    retry: false,
  });
  const conflicts = useQuery({
    queryKey: ['conflicts', focus?.id],
    queryFn: () => api.get<{ conflicts: Array<{ status: string; severity: string }> }>(`/api/projects/${focus!.id}/conflicts`),
    enabled: Boolean(focus),
    retry: false,
  });
  const provenance = useQuery({
    queryKey: ['provenance', focus?.id],
    queryFn: () => api.get<{ project: unknown } | null>(`/api/projects/${focus!.id}/provenance`),
    enabled: Boolean(focus),
    retry: false,
  });

  if (projects.isLoading) return <Loading label="Loading your projects…" />;

  const d = detail.data;
  const totalInputs = d ? Object.values(d.inputCounts || {}).reduce((a, b) => a + b, 0) : 0;
  const openConflicts = conflicts.data?.conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision').length ?? 0;
  const taskList = tasks.data ?? [];
  const scriptDone = taskList.some((t) => t.stage === 'script' && t.status !== 'failed');
  const approved = taskList.some((t) => t.reviewStatus === 'approved');
  const contractDone = d?.latestContract?.status === 'approved' || d?.latestContract?.status === 'locked';
  const verified =
    provenance.data !== undefined && provenance.data !== null && provenance.isSuccess && provenance.data !== null;

  const steps: Step[] = [
    {
      key: 'workspace',
      label: 'Create or join a workspace',
      detail: 'Workspaces hold your team, brand DNA and budget settings.',
      done: true,
      to: '/app',
    },
    {
      key: 'project',
      label: 'Create your first campaign',
      detail: 'Solo or team mode — pick a project type and set budget and deadline.',
      done: Boolean(focus),
      to: '/app/projects/new',
    },
    {
      key: 'inputs',
      label: 'Collect role-based inputs',
      detail: 'The AI wizard asks only what is missing; each answer becomes a Knowledge Input.',
      done: totalInputs > 0,
      to: `${base}/inputs`,
    },
    {
      key: 'conflicts',
      label: 'Detect and resolve conflicts',
      detail: 'The consensus engine finds contradictions and rights issues, then routes them to a decision-maker.',
      done: Boolean(focus) && conflicts.isSuccess && openConflicts === 0 && totalInputs > 0,
      to: `${base}/conflicts`,
    },
    {
      key: 'risk',
      label: 'Read the Waste Receipt',
      detail: 'Cost-at-Risk shows what generating now would waste — and the fixes.',
      done: Boolean(focus),
      to: `${base}/risk`,
    },
    {
      key: 'contract',
      label: 'Approve the Production Contract',
      detail: 'Generation is contract-anchored: nothing expensive runs before approval.',
      done: Boolean(contractDone),
      to: `${base}/contract`,
    },
    {
      key: 'script',
      label: 'Generate script and storyboard',
      detail: 'Progressive draft ladder — concept → script → storyboard, each approved separately.',
      done: scriptDone,
      to: `${base}/ladder`,
    },
    {
      key: 'verify',
      label: 'Verify the output',
      detail: 'Twelve checks: claims, intent, brand, rights, accessibility, budget…',
      done: approved,
      to: `${base}/verification`,
    },
    {
      key: 'provenance',
      label: 'Export the Provenance Passport',
      detail: 'Who supplied what, which model wrote it, what it cost — downloadable as PDF/JSON.',
      done: Boolean(provenance.data),
      to: `${base}/provenance`,
    },
  ];

  const firstPending = steps.findIndex((s) => !s.done);
  const doneCount = steps.filter((s) => s.done).length;

  if (!focus) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
          <Rocket className="h-5 w-5 text-brand-600" aria-hidden /> Getting started
        </h1>
        <EmptyState
          icon={<Rocket className="h-8 w-8" />}
          title="Create your first campaign to begin the tour"
          description="The tour follows ReadyForge's real MVP loop: inputs → conflicts → Waste Receipt → contract → generation → verification → provenance."
          action={
            <Link to="/app/projects/new" className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              New campaign <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionTitle
        title="Getting started"
        subtitle="The complete ReadyForge loop, tracked against your most recent campaign's real state."
        action={
          <Badge tone={doneCount === steps.length ? 'success' : 'brand'}>
            {doneCount}/{steps.length} complete
          </Badge>
        }
      />

      <Card className="p-5">
        <p className="mb-4 text-sm text-slate-500">
          Following <strong>{d?.title || focus.title}</strong> — switch campaigns by opening one first.
        </p>
        <ol className="space-y-2">
          {steps.map((s, i) => {
            const current = i === firstPending;
            return (
              <li key={s.key}>
                <Link
                  to={s.to}
                  className={cx(
                    'flex items-start gap-3 rounded-lg border p-3 transition hover:border-brand-300',
                    s.done
                      ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-500/30 dark:bg-emerald-500/5'
                      : current
                        ? 'border-brand-400 bg-brand-50/50 dark:border-brand-500/40 dark:bg-brand-500/10'
                        : 'border-slate-200 dark:border-slate-700'
                  )}
                >
                  {s.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                  ) : (
                    <Circle className={cx('mt-0.5 h-4 w-4 shrink-0', current ? 'text-brand-500' : 'text-slate-300')} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      {s.label}
                      {current && <Badge tone="brand">next step</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">{s.detail}</span>
                  </span>
                  <ArrowRight className="mt-1 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ol>
      </Card>

      <Card className="border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/25 dark:bg-brand-500/5">
        <p className="text-sm text-slate-700 dark:text-slate-200">
          Everything else — Creative Taste, Campaign Lab, Analytics, Judge Mode — is optional depth.
          When the nine steps above are green, your campaign has completed the full production-readiness loop.
        </p>
      </Card>
    </div>
  );
}
