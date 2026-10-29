import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldAlert, CheckCircle2, Lightbulb, RefreshCw, LockKeyhole, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Loading, Progress, Badge, SectionTitle, cx } from '../components/ui';
import { useProject } from './ProjectLayout';
import { toast } from '../store/toast';

interface ReadinessReport {
  score: number;
  categories: Array<{ key: string; label: string; weight: number; score: number; reason: string }>;
  blockingIssues: Array<{ code: string; message: string; severity: string }>;
  warnings: Array<{ code: string; message: string; severity: string }>;
  recommendations: string[];
  missingRequirements: string[];
  approvalGate: { required: number; approved: number; satisfied: boolean };
  generatedAt: string;
}

export default function ReadinessDashboard() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [report, setReport] = useState<ReadinessReport | null>(null);

  const current = useQuery({
    queryKey: ['readiness', project?.id],
    queryFn: () => api.get<ReadinessReport>(`/api/projects/${project!.id}/readiness`),
    enabled: Boolean(project?.id),
  });

  const validate = useMutation({
    mutationFn: () => api.post<ReadinessReport>(`/api/projects/${project!.id}/validate`),
    onSuccess: (data) => {
      setReport(data);
      toast.success(`Validation complete — readiness ${data.score}/100`);
      void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
      void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  const data = report || current.data;
  if (current.isLoading && !data) return <Loading label="Calculating readiness…" />;
  if (current.error && !data) return <ErrorBox error={current.error} />;
  if (!data) return null;

  const blockers = data.blockingIssues;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Readiness Dashboard"
        subtitle="Transparent scoring — every point has a reason."
        action={
          <Button onClick={() => validate.mutate()} loading={validate.isPending}>
            <RefreshCw className="h-4 w-4" /> Run validation
          </Button>
        }
      />

      <Card className={cx(
        'overflow-hidden border-l-4 p-5',
        blockers.length ? 'border-l-rose-500 bg-rose-50/40 dark:bg-rose-950/10' : 'border-l-emerald-500 bg-emerald-50/40 dark:bg-emerald-950/10'
      )}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className={cx('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', blockers.length ? 'bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300' : 'bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300')}>
              {blockers.length ? <ShieldAlert className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
            </span>
            <div>
              <p className="text-sm font-semibold">{blockers.length ? 'Production gate is closed' : 'Production gate is open'}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                {blockers.length ? `${blockers.length} blocking issue${blockers.length === 1 ? '' : 's'} must be resolved before generation.` : 'No blocking issues detected. Keep the contract and approvals current.'}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-slate-500">
            <LockKeyhole className="h-3.5 w-3.5" /> Approval gate {data.approvalGate.approved}/{data.approvalGate.required}
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Score */}
        <Card className="flex flex-col items-center justify-center p-6 text-center">
          <p className="text-xs uppercase tracking-wider text-slate-400">Readiness score</p>
          <p
            className={cx(
              'mt-2 text-6xl font-bold tabular-nums',
              data.score >= 75 ? 'text-emerald-500' : data.score >= 50 ? 'text-amber-500' : 'text-rose-500'
            )}
          >
            {Math.round(data.score)}
          </p>
          <p className="mt-1 text-sm text-slate-500">out of 100</p>
          <div className="mt-4 w-full">
            <Progress value={data.score} />
          </div>
          <div className="mt-4 flex w-full justify-around text-xs">
            <div>
              <p className="font-bold text-rose-500">{blockers.length}</p>
              <p className="text-slate-500">blockers</p>
            </div>
            <div>
              <p className="font-bold text-amber-500">{data.warnings.length}</p>
              <p className="text-slate-500">warnings</p>
            </div>
            <div>
              <p className="font-bold text-brand-500">{data.missingRequirements.length}</p>
              <p className="text-slate-500">missing</p>
            </div>
          </div>
          <p className="mt-4 text-[10px] text-slate-400">
            Recomputed {new Date(data.generatedAt).toLocaleString()}
          </p>
        </Card>

        {/* Breakdown */}
        <Card className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold tracking-tight">Category breakdown</h3>
              <p className="mt-0.5 text-xs text-slate-500">Weighted signals behind the score.</p>
            </div>
            <Badge tone="neutral">{data.categories.length} signals</Badge>
          </div>
          <div className="mt-4 space-y-4">
            {data.categories.map((c) => {
              const pctOfWeight = c.weight ? (c.score / c.weight) * 100 : 0;
              return (
                <div key={c.key}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">
                      {c.label} <span className="text-xs text-slate-400">({c.weight}%)</span>
                    </span>
                    <span className="tabular-nums text-slate-500">
                      {c.score.toFixed(1)} / {c.weight}
                    </span>
                  </div>
                  <Progress value={pctOfWeight} />
                  <p className="mt-1 text-xs text-slate-500">{c.reason}</p>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Issues + recommendations */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="flex items-center gap-2 text-base font-semibold text-rose-600">
            <ShieldAlert className="h-4 w-4" /> Blocking issues ({blockers.length})
          </h3>
          {blockers.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" /> Nothing blocking — generation gates are open.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {blockers.map((b, i) => (
                <li key={i} className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
                  {b.message}
                </li>
              ))}
            </ul>
          )}

          <h3 className="mt-5 flex items-center gap-2 text-base font-semibold text-amber-600">
            <ShieldAlert className="h-4 w-4" /> Warnings ({data.warnings.length})
          </h3>
          {data.warnings.length === 0 ? (
            <p className="mt-3 text-sm text-slate-500">No warnings.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {data.warnings.map((w, i) => (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                  {w.message}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Lightbulb className="h-4 w-4 text-brand-500" /> Recommended actions
            </h3>
            {data.recommendations.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">Nothing to fix right now.</p>
            ) : (
              <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {data.recommendations.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Missing requirements</h3>
            {data.missingRequirements.length === 0 ? (
              <p className="mt-3 text-sm text-emerald-600">All required information is present.</p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {data.missingRequirements.map((m, i) => (
                  <Badge key={i} tone="warning">{m}</Badge>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Approval gate</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              {data.approvalGate.required === 0
                ? 'No contract approvals requested yet.'
                : `${data.approvalGate.approved}/${data.approvalGate.required} required approvals collected`}
            </p>
            {data.approvalGate.required > 0 && (
              <div className="mt-2">
                <Progress value={(data.approvalGate.approved / data.approvalGate.required) * 100} />
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
