import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, RefreshCw, TrendingDown, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Loading, Progress, SectionTitle, Badge } from '../components/ui';
import { useProject } from './ProjectLayout';
import { toast } from '../store/toast';

interface CostReport {
  plannedCost: number;
  reworkProbability: number;
  estimatedLoss: number;
  currency: string;
  reasons: string[];
  recommendedActions: string[];
  nextStage: string;
  signals: Array<{ label: string; contribution: number }>;
  disclaimer: string;
  generatedAt: string;
}

export default function CostAtRiskDashboard() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();

  const current = useQuery({
    queryKey: ['cost-at-risk', project?.id],
    queryFn: () => api.get<CostReport>(`/api/projects/${project!.id}/cost-at-risk`),
    enabled: Boolean(project?.id),
  });

  const recalc = useMutation({
    mutationFn: () => api.get<CostReport>(`/api/projects/${project!.id}/cost-at-risk`),
    onSuccess: (data) => {
      toast.success(`Estimated loss: ${data.currency} ${data.estimatedLoss.toLocaleString('en-IN')}`);
      void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  if (current.isLoading) return <Loading label="Computing cost at risk…" />;
  if (current.error) return <ErrorBox error={current.error} />;
  const data = current.data;
  if (!data) return null;

  const pct = Math.round(data.reworkProbability * 100);
  const risky = pct >= 40;

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Cost-at-Risk Dashboard"
        subtitle="Cost at Risk = Planned Generation Cost × Estimated Rework Probability"
        action={
          <Button variant="outline" onClick={() => recalc.mutate()} loading={recalc.isPending}>
            <RefreshCw className="h-4 w-4" /> Recalculate
          </Button>
        }
      />

      {/* Headline */}
      <Card className={risky ? 'border-rose-300 p-6 dark:border-rose-900' : 'border-emerald-300 p-6 dark:border-emerald-900'}>
        <div className="flex flex-wrap items-center gap-3">
          <Calculator className={risky ? 'h-6 w-6 text-rose-500' : 'h-6 w-6 text-emerald-500'} />
          <Badge tone={risky ? 'danger' : 'success'}>estimate — not a guarantee</Badge>
        </div>
        <p className={'mt-3 text-lg font-semibold leading-relaxed ' + (risky ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300')}>
          Rendering now: {pct}% chance of rework. {data.currency} {data.estimatedLoss.toLocaleString('en-IN')} at risk on{' '}
          {data.nextStage.toLowerCase()} ({data.currency} {data.plannedCost.toLocaleString('en-IN')} planned).
        </p>
        <div className="mt-4 max-w-md">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>Rework probability</span>
            <span className="font-bold tabular-nums">{pct}%</span>
          </div>
          <Progress value={pct} tone={risky ? 'danger' : 'success'} />
        </div>
        <p className="mt-3 text-xs italic text-slate-500">{data.disclaimer}</p>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Signals */}
        <Card className="p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
            Risk signals & contributions
          </h3>
          <div className="mt-4 space-y-3">
            {data.signals.length === 0 ? (
              <p className="text-sm text-slate-500">No risk signals detected.</p>
            ) : (
              data.signals.map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-sm">
                    <span className="capitalize">{s.label.replace(/_/g, ' ')}</span>
                    <span className="tabular-nums text-slate-500">+{Math.round(s.contribution * 100)}%</span>
                  </div>
                  <Progress value={(s.contribution / 0.95) * 100} tone="danger" className="mt-1 h-1.5" />
                </div>
              ))
            )}
          </div>

          <h3 className="mt-6 text-sm font-semibold uppercase tracking-wider text-slate-400">Why</h3>
          <ul className="mt-2 space-y-1.5 text-sm text-slate-600 dark:text-slate-300">
            {data.reasons.map((r, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-500">•</span> {r}
              </li>
            ))}
          </ul>
        </Card>

        {/* Actions */}
        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <TrendingDown className="h-4 w-4 text-emerald-500" /> Reduce risk below 10%
            </h3>
            {data.recommendedActions.length === 0 ? (
              <p className="mt-2 text-sm text-emerald-600">Risk is already low — generation recommended.</p>
            ) : (
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {data.recommendedActions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ol>
            )}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Budget guardrail</h3>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Remaining budget: <strong>{project.budget.currency} {project.budget.remaining.toLocaleString('en-IN')}</strong>
              <br />
              Planned cost: <strong>{data.currency} {data.plannedCost.toLocaleString('en-IN')}</strong>
            </p>
            {project.budget.remaining < data.plannedCost && (
              <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                Planned cost exceeds remaining budget — finance-owner or lead approval is required before generation.
              </p>
            )}
            <Link to={`/app/projects/${project.id}/contract`} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
              Review Production Contract <ArrowRight className="h-3 w-3" />
            </Link>
          </Card>
        </div>
      </div>
    </div>
  );
}
