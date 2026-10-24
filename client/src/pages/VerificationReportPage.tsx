import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, PlayCircle, XCircle } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, SectionTitle, cx } from '../components/ui';
import { AiSourceBadge, SeverityBadge } from '../components/widgets';

interface Check {
  checkType: string;
  status: 'passed' | 'warning' | 'failed';
  severity: string;
  message: string;
  evidence: string;
  suggestedFix?: string;
}

interface Report {
  id: string;
  status: 'passed' | 'warning' | 'failed';
  overallScore: number;
  summary: string;
  checks: Check[];
  createdAt: string;
}

const STATUS_META = {
  passed: { icon: CheckCircle2, tone: 'success' as const, label: 'Passed' },
  warning: { icon: AlertTriangle, tone: 'warning' as const, label: 'Warning' },
  failed: { icon: XCircle, tone: 'danger' as const, label: 'Failed' },
};

const STATUS_RING = {
  passed: 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  warning: 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300',
  failed: 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300',
};

/**
 * Verification Report — runs the Output Verification Agent against the approved
 * contract (claims via the trained NLI model + rules, rights/budget/scenes
 * deterministically, intent/brand/tone via the local LLM) and renders every check
 * with its evidence and suggested fix.
 */
export default function VerificationReportPage() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const [aiMeta, setAiMeta] = useState<{ source?: string; model?: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['verification', projectId],
    queryFn: () => api.get<Report[]>(`/api/projects/${projectId}/verification`),
    enabled: Boolean(projectId),
  });

  const run = useMutation({
    mutationFn: () => api.post<{ report: Report; aiSource: string; model: string }>(`/api/projects/${projectId}/verify`),
    onSuccess: (res) => {
      setAiMeta({ source: res.aiSource, model: res.model });
      toast.success(`Verification finished: ${res.report.status} (${res.report.overallScore}%)`);
      queryClient.invalidateQueries({ queryKey: ['verification', projectId] });
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading verification reports…" />;
  if (error) return <ErrorBox error={error} />;

  const reports = data || [];
  const latest = reports[0];
  const base = `/app/projects/${projectId}`;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Output Verification"
        subtitle="Every generated output is checked against the approved Production Contract before it can be approved."
        action={
          <Button variant="primary" size="sm" disabled={run.isPending} onClick={() => run.mutate()}>
            <PlayCircle className="mr-1 h-4 w-4" />
            {run.isPending ? 'Verifying…' : 'Run verification'}
          </Button>
        }
      />

      {!latest ? (
        <EmptyState
          icon={<CheckCircle2 className="h-6 w-6" />}
          title="No verification yet"
          description="Generate a script on the Draft Ladder, then run verification to see contract compliance checks."
        />
      ) : (
        <>
          <Card className={cx('border', STATUS_RING[latest.status])}>
            <div className="flex flex-wrap items-center gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-full border border-current/30 bg-white/60 dark:bg-black/20">
                {(() => {
                  const Icon = STATUS_META[latest.status].icon;
                  return <Icon className="h-6 w-6" />;
                })()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">
                    {STATUS_META[latest.status].label} · {latest.overallScore}/100
                  </h3>
                  <Badge tone="neutral">{new Date(latest.createdAt).toLocaleString()}</Badge>
                  {aiMeta?.source && <AiSourceBadge source={aiMeta.source} model={aiMeta.model} />}
                </div>
                <p className="mt-1 text-sm opacity-90">{latest.summary}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold tabular-nums">{latest.overallScore}%</div>
                <div className="text-xs opacity-70">
                  {latest.checks.filter((c) => c.status === 'passed').length}/{latest.checks.length} checks green
                </div>
              </div>
            </div>
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            {latest.checks.map((check) => {
              const Icon = STATUS_META[check.status].icon;
              return (
                <Card key={check.checkType} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Icon
                        className={cx(
                          'h-4 w-4',
                          check.status === 'passed' && 'text-emerald-600',
                          check.status === 'warning' && 'text-amber-600',
                          check.status === 'failed' && 'text-red-600'
                        )}
                      />
                      <span className="text-sm font-semibold capitalize">{check.checkType.replace(/_/g, ' ')}</span>
                    </div>
                    <div className="flex gap-1">
                      <SeverityBadge severity={check.severity} />
                      <Badge tone={STATUS_META[check.status].tone}>{check.status}</Badge>
                    </div>
                  </div>
                  <p className="text-sm text-slate-700 dark:text-slate-300">{check.message}</p>
                  <div className="rounded-md bg-slate-50 p-2 text-xs text-slate-600 dark:bg-slate-900 dark:text-slate-400">
                    <span className="font-medium">Evidence:</span> {check.evidence}
                  </div>
                  {check.suggestedFix && (
                    <p className="text-xs text-brand-700 dark:text-brand-300">
                      <span className="font-medium">Fix:</span> {check.suggestedFix}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        </>
      )}

      {reports.length > 1 && (
        <div>
          <SectionTitle title="History" subtitle="Previous verification runs for this project." />
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[520px] text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2 font-medium">Run</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Score</th>
                  <th className="px-4 py-2 font-medium">Summary</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 text-slate-500">{new Date(r.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      <Badge tone={STATUS_META[r.status].tone}>{r.status}</Badge>
                    </td>
                    <td className="px-4 py-2 tabular-nums">{r.overallScore}%</td>
                    <td className="max-w-md truncate px-4 py-2 text-slate-500">{r.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </div>
  );
}