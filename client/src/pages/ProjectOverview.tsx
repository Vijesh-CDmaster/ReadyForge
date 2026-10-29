import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, ShieldAlert, CheckCircle2, Clock, UsersRound, Database, WalletCards } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Field, Input, Loading, Modal, SectionTitle, Textarea, Badge } from '../components/ui';
import { ReadinessMeter, CostAtRiskCard, StatusBadge } from '../components/widgets';
import { useProject } from './ProjectLayout';
import { toast } from '../store/toast';

interface ReadinessReport {
  score: number;
  categories: Array<{ key: string; label: string; weight: number; score: number; reason: string }>;
  blockingIssues: Array<{ code: string; message: string; severity: string }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
  recommendations: string[];
  missingRequirements: string[];
  productionAuthorization: { authorized: boolean; blockers: Array<{ code: string; message: string; severity: string }> };
  generatedAt: string;
}

interface CostReport {
  plannedCost: number;
  reworkProbability: number;
  estimatedLoss: number;
  currency: string;
  reasons: string[];
  recommendedActions: string[];
  nextStage: string;
  disclaimer: string;
}

interface ActivityItem {
  id: string;
  action: string;
  entityType: string;
  actor: string;
  createdAt: string;
}

export default function ProjectOverview() {
  const { data: project, isLoading, error } = useProject();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editValues, setEditValues] = useState<Record<string, unknown>>({});
  const setEdit = (key: string, value: unknown) => setEditValues((v) => ({ ...v, [key]: value }));

  const { data: readiness, isLoading: readinessLoading, error: readinessError } = useQuery({
    queryKey: ['readiness', project?.id],
    queryFn: () => api.get<ReadinessReport>(`/api/projects/${project!.id}/readiness`),
    enabled: Boolean(project?.id),
  });

  const { data: cost } = useQuery({
    queryKey: ['cost-at-risk', project?.id],
    queryFn: () => api.get<CostReport>(`/api/projects/${project!.id}/cost-at-risk`),
    enabled: Boolean(project?.id),
  });

  const { data: activity } = useQuery({
    queryKey: ['activity', project?.id],
    queryFn: () => api.get<ActivityItem[]>(`/api/projects/${project!.id}/activity`),
    enabled: Boolean(project?.id),
    refetchInterval: 20_000,
  });

  const update = useMutation({
    mutationFn: (values: Partial<Record<string, unknown>>) => api.patch(`/api/projects/${project!.id}`, values),
    onSuccess: () => {
      toast.success('Project updated');
      setEditOpen(false);
      void queryClient.invalidateQueries({ queryKey: ['project', project!.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  // Hooks must run before the early returns below — the button that calls this
  // only renders when `project` exists, so the null assertions are call-time safe.
  const saveTemplate = useMutation({
    mutationFn: () =>
      api.post(`/api/workspaces/${project!.workspaceId}/templates`, {
        name: project!.title,
        description: `Saved from “${project!.title}”`,
        projectType: project!.projectType,
        mode: project!.mode,
        sourceProjectId: project!.id,
      }),
    onSuccess: () => toast.success('Saved as a workspace template — pick it in New project'),
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorBox error={error} />;
  if (!project) return null;

  const openEdit = () => {
    setEditValues({
      title: project.title,
      description: project.description,
      objective: project.objective,
      audience: project.audience,
      tone: project.tone,
      callToAction: project.callToAction,
      successMetric: project.successMetric,
      budget: { amount: project.budget.amount, currency: project.budget.currency },
    });
    setEditOpen(true);
  };

  const blockers = readiness?.blockingIssues || [];
  const authorizationBlockers = readiness?.productionAuthorization.blockers || [];
  const liveScore = readiness?.score;
  const displayedScore = liveScore ?? project.readinessScore;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryStat label={liveScore === undefined ? 'Stored readiness score' : 'Readiness'} value={`${Math.round(displayedScore)}/100`} detail={liveScore === undefined ? 'Last-validated value; current status unavailable' : `${authorizationBlockers.length ? `${authorizationBlockers.length} authorization blocker${authorizationBlockers.length === 1 ? '' : 's'}` : 'Production authorization open'}`} icon={<CheckCircle2 className="h-4 w-4" />} tone={liveScore === undefined ? 'warning' : authorizationBlockers.length ? 'warning' : 'success'} />
        <SummaryStat label="Budget remaining" value={`${project.budget.currency} ${project.budget.remaining.toLocaleString('en-IN')}`} detail={`of ${project.budget.amount.toLocaleString('en-IN')} planned`} icon={<WalletCards className="h-4 w-4" />} />
        <SummaryStat label="Project inputs" value={`${Object.values(project.inputCounts || {}).reduce((a, b) => a + b, 0)}`} detail={`${project.members.length} team member${project.members.length === 1 ? '' : 's'}`} icon={<Database className="h-4 w-4" />} />
      </div>

    <div className="grid gap-5 lg:grid-cols-3">
      {/* Left: brief + details */}
      <div className="space-y-5 lg:col-span-2">
        <Card className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-semibold tracking-tight">Intent brief</h2>
                <StatusBadge status={project.status} />
                {project.latestContract && (
                  <Badge tone="brand">
                    Contract v{project.latestContract.version} · {project.latestContract.status.replace('_', ' ')}
                  </Badge>
                )}
              </div>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{project.description || 'No description.'}</p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" loading={saveTemplate.isPending} onClick={() => saveTemplate.mutate()} title="Save this project's brief as a reusable template">
                Save as template
              </Button>
              <Button variant="outline" size="sm" onClick={openEdit}>
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <Detail label="Objective" value={project.objective} />
            <Detail label="Audience" value={project.audience} />
            <Detail label="Tone" value={project.tone} />
            <Detail label="Call to action" value={project.callToAction} />
            <Detail label="Success metric" value={project.successMetric} />
            <Detail label="Deadline" value={project.deadline ? new Date(project.deadline).toLocaleDateString() : undefined} />
          </dl>

          <div className="mt-4 flex flex-wrap gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
            <span>
              Budget: <strong>{project.budget.currency} {project.budget.amount.toLocaleString('en-IN')}</strong>
            </span>
            <span>
              Remaining: <strong>{project.budget.currency} {project.budget.remaining.toLocaleString('en-IN')}</strong>
            </span>
            <span>
              Mode: <strong>{project.mode}</strong>
            </span>
            <span>
              Type: <strong>{project.projectType.replace('_', ' ')}</strong>
            </span>
          </div>
        </Card>

        {/* Readiness summary */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold tracking-tight">Readiness snapshot</h2>
            <Link to={`/app/projects/${project.id}/readiness`} className="text-xs font-medium text-brand-600 hover:underline">
              Full dashboard →
            </Link>
          </div>

          <div className="mt-3">
            <ReadinessMeter score={displayedScore} />
          </div>

          {readinessLoading && (
            <p className="mt-3 text-xs text-slate-500">Loading current readiness and production authorization…</p>
          )}

          {readinessError && !readiness && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">Current readiness is unavailable. The score shown is the stored last-validated value; it may be stale.</p>
          )}

          {!readiness && !readinessLoading && !readinessError && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">No current readiness assessment is available. The stored score may be stale.</p>
          )}

          {readiness && !readiness.productionAuthorization.authorized && (
            <div className="mt-4 space-y-2">
              {authorizationBlockers.map((b, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200"
                >
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{b.message}</span>
                </div>
              ))}
            </div>
          )}

          {readiness && readiness.productionAuthorization.authorized && (
            <p className="mt-3 flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" /> Production authorization is open for the current readiness assessment.
            </p>
          )}

          {readiness && blockers.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {blockers.length} common readiness diagnostic{blockers.length === 1 ? '' : 's'} reported; see the dashboard for details.
            </p>
          )}

          {readiness && readiness.warnings.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {readiness.warnings.slice(0, 3).map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300">
                  <Clock className="mt-0.5 h-3 w-3 shrink-0" /> {w.message}
                </li>
              ))}
            </ul>
          )}

          {readiness && blockers.length === 0 && (
            <p className="mt-3 text-xs text-slate-500">No common rubric diagnostics detected.</p>
          )}

          <p className="mt-3 text-[11px] text-slate-400">
            {readiness ? `Current assessment computed ${new Date(readiness.generatedAt).toLocaleString()}.` : 'Stored score is not guaranteed to reflect current project evidence.'}
          </p>

          <div className="mt-4 flex flex-wrap gap-2">
            <Link to={`/app/projects/${project.id}/knowledge/inputs`}>
              <Button size="sm" variant="outline">Answer AI questions</Button>
            </Link>
            <Link to={`/app/projects/${project.id}/conflicts`}>
              <Button size="sm" variant="outline">Conflict room</Button>
            </Link>
            <Link to={`/app/projects/${project.id}/contract`}>
              <Button size="sm" variant="outline">Production contract</Button>
            </Link>
          </div>
        </Card>

        {/* Activity */}
        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight">Activity timeline</h2>
          {!activity?.length ? (
            <p className="mt-3 text-sm text-slate-500">No activity recorded yet.</p>
          ) : (
            <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
              {activity.slice(0, 12).map((a) => (
                <li key={a.id} className="relative text-xs">
                  <span className="absolute -left-[21px] top-1 h-2 w-2 rounded-full bg-brand-500" />
                  <p>
                    <strong>{a.actor}</strong> · {a.action.replace(/\./g, ' ')}
                  </p>
                  <p className="text-slate-400">{new Date(a.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>

      {/* Right rail */}
      <div className="space-y-5">
        <CostAtRiskCard data={cost} />

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight"><UsersRound className="h-4 w-4 text-brand-500" /> Project team</h2>
          <ul className="mt-3 space-y-2.5">
            {project.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="truncate">{m.name}</span>
                <Badge tone="neutral">{m.projectRole.replace('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-5">
          <h2 className="text-base font-semibold tracking-tight">Ledger status</h2>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(project.inputCounts || {}).map(([status, count]) => (
              <Badge key={status} tone={status === 'approved' ? 'success' : status === 'disputed' ? 'danger' : 'neutral'}>
                {count} {status}
              </Badge>
            ))}
            {Object.keys(project.inputCounts || {}).length === 0 && (
              <p className="text-xs text-slate-500">No inputs yet.</p>
            )}
          </div>
        </Card>
      </div>

      {/* Edit modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit project brief"
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button loading={update.isPending} onClick={() => update.mutate(editValues)}>
              Save changes
            </Button>
          </>
        }
      >
        <Field label="Title"><Input defaultValue={project.title} onChange={(e) => setEdit('title', e.target.value)} /></Field>
        <Field label="Description"><Textarea defaultValue={project.description} onChange={(e) => setEdit('description', e.target.value)} /></Field>
        <Field label="Objective"><Textarea defaultValue={project.objective} onChange={(e) => setEdit('objective', e.target.value)} /></Field>
        <Field label="Audience"><Input defaultValue={project.audience} onChange={(e) => setEdit('audience', e.target.value)} /></Field>
        <Field label="Tone"><Input defaultValue={project.tone} onChange={(e) => setEdit('tone', e.target.value)} /></Field>
        <Field label="Call to action"><Input defaultValue={project.callToAction} onChange={(e) => setEdit('callToAction', e.target.value)} /></Field>
        <Field label="Success metric"><Input defaultValue={project.successMetric} onChange={(e) => setEdit('successMetric', e.target.value)} /></Field>
        <Field label="Budget (INR)"><Input type="number" defaultValue={project.budget.amount} onChange={(e) => setEdit('budget', { amount: Number(e.target.value) || 0, currency: project.budget.currency })} /></Field>
      </Modal>
    </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  detail,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: string;
  detail: string;
  icon: React.ReactNode;
  tone?: 'brand' | 'success' | 'warning';
}) {
  const tones = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300',
    success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  };
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{label}</p>
        <p className="mt-1 truncate text-base font-semibold tabular-nums">{value}</p>
        <p className="mt-0.5 truncate text-xs text-slate-500">{detail}</p>
      </div>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-sm ${value ? '' : 'italic text-slate-400'}`}>
        {value || `Not set — the AI wizard will ask.`}
      </dd>
    </div>
  );
}
