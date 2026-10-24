import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { api } from '../lib/api';
import { Badge, Card, EmptyState, ErrorBox, Loading, Progress, SectionTitle } from '../components/ui';

interface AnalyticsPayload {
  projects: { total: number; byStatus: Record<string, number>; avgReadiness: number; readyToGenerate: number };
  ai: {
    totalSpend: number;
    currency: string;
    calls: number;
    spendByModel: Array<{ model: string; cost: number; calls: number }>;
    spendByDay: Array<{ date: string; spend: number; tasks: number }>;
    modelPerformance: Array<{
      model: string;
      calls: number;
      cost: number;
      tasks: number;
      firstPassRate: number | null;
      avgLatencyMs: number | null;
    }>;
    failedCalls: number;
  };
  generation: {
    tasks: number;
    approved: number;
    rejected: number;
    failed: number;
    firstPassRate: number | null;
    regenerationRate: number;
    avgLatencyMs: number;
  };
  conflicts: { total: number; open: number; resolved: number; byType: Record<string, number> };
  verification: { runs: number; byStatus: Record<string, number> };
  reviews: Record<string, number>;
}

interface AiUsageRow {
  id: string;
  projectId: string | null;
  provider: string;
  model: string;
  taskType: string;
  cost: number;
  currency: string;
  status: string;
  latencyMs: number;
  createdAt: string;
}

const PIE_COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#64748b', '#ec4899', '#14b8a6', '#84cc16'];

const axisStyle = { fontSize: 11, fill: '#94a3b8' };

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-500">{hint}</p>}
    </Card>
  );
}

/**
 * Analytics Dashboard (spec §13): AI spend over time, project status, conflict
 * types, model performance table and regeneration rate.
 */
export default function AnalyticsPage() {
  const { workspaceId = '' } = useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', workspaceId],
    queryFn: () => api.get<AnalyticsPayload>(`/api/workspaces/${workspaceId}/analytics`),
    enabled: Boolean(workspaceId),
  });

  const { data: usage } = useQuery({
    queryKey: ['ai-usage', workspaceId],
    queryFn: () => api.get<AiUsageRow[]>(`/api/workspaces/${workspaceId}/ai-usage`),
    enabled: Boolean(workspaceId),
  });

  if (isLoading) return <Loading label="Loading analytics…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const statusData = Object.entries(data.projects.byStatus).map(([name, value]) => ({ name, value }));
  const conflictData = Object.entries(data.conflicts.byType).map(([name, value]) => ({ name, value }));
  const currency = data.ai.currency;

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Analytics"
        subtitle="Workspace-wide performance: readiness, AI spend, regeneration and conflicts."
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Projects" value={String(data.projects.total)} hint={`${data.projects.readyToGenerate} ready to generate`} />
        <StatCard label="Avg readiness" value={`${data.projects.avgReadiness}%`} />
        <StatCard
          label="AI spend"
          value={`${data.ai.totalSpend.toLocaleString('en-IN')} ${currency}`}
          hint={`${data.ai.calls} calls · ${data.ai.failedCalls} failed`}
        />
        <StatCard
          label="First-pass approval"
          value={data.generation.firstPassRate === null ? '—' : `${data.generation.firstPassRate}%`}
          hint={`${data.generation.regenerationRate}% regeneration rate`}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* spend over time */}
        <Card className="lg:col-span-2">
          <p className="mb-3 text-sm font-semibold">AI spend & generations (last 14 days)</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.ai.spendByDay} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="date" tick={axisStyle} tickFormatter={(d) => d.slice(5)} />
                <YAxis tick={axisStyle} />
                <Tooltip />
                <Line type="monotone" dataKey="spend" name={`Spend (${currency})`} stroke="#4f46e5" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="tasks" name="Generations" stroke="#10b981" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* project status pie */}
        <Card>
          <p className="mb-3 text-sm font-semibold">Projects by status</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={2}>
                  {statusData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {statusData.map((s, i) => (
              <span key={s.name} className="flex items-center gap-1 text-xs text-slate-500">
                <span className="h-2 w-2 rounded-full" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} />
                {s.name} ({s.value})
              </span>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* conflict types */}
        <Card>
          <p className="mb-3 text-sm font-semibold">Conflicts by type</p>
          {conflictData.length === 0 ? (
            <EmptyState title="No conflicts recorded" description="Run conflict detection from the Conflict Room." />
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={conflictData} margin={{ top: 4, right: 8, bottom: 0, left: -22 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="name" tick={axisStyle} />
                  <YAxis tick={axisStyle} allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="value" name="Count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <p className="mt-2 text-xs text-slate-500">
            {data.conflicts.total} total · {data.conflicts.resolved} resolved · {data.conflicts.open} open
          </p>
        </Card>

        {/* model performance */}
        <Card>
          <p className="mb-3 text-sm font-semibold">Model performance</p>
          {data.ai.modelPerformance.length === 0 ? (
            <EmptyState title="No AI calls yet" description="Generate a rung on the Draft Ladder to populate this table." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[440px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Model</th>
                    <th className="py-2 pr-3 font-medium">Calls</th>
                    <th className="py-2 pr-3 font-medium">Cost</th>
                    <th className="py-2 pr-3 font-medium">First pass</th>
                    <th className="py-2 font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.ai.modelPerformance.map((m) => (
                    <tr key={m.model}>
                      <td className="py-2 pr-3 font-medium">{m.model}</td>
                      <td className="py-2 pr-3 tabular-nums">{m.calls}</td>
                      <td className="py-2 pr-3 tabular-nums">
                        {m.cost} {currency}
                      </td>
                      <td className="py-2 pr-3">{m.firstPassRate === null ? '—' : `${m.firstPassRate}%`}</td>
                      <td className="py-2 tabular-nums">{m.avgLatencyMs === null ? '—' : `${m.avgLatencyMs}ms`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* verification & reviews */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <p className="mb-2 text-sm font-semibold">Verification runs</p>
          {data.verification.runs === 0 ? (
            <p className="text-xs text-slate-500">No verification runs yet.</p>
          ) : (
            <div className="space-y-2">
              {Object.entries(data.verification.byStatus).map(([status, count]) => (
                <div key={status}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span className="capitalize">{status}</span>
                    <span className="tabular-nums">{count}</span>
                  </div>
                  <Progress
                    value={(count / data.verification.runs) * 100}
                    tone={status === 'passed' ? 'success' : status === 'warning' ? 'warning' : 'danger'}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <p className="mb-2 text-sm font-semibold">Review decisions</p>
          <div className="flex flex-wrap gap-2">
            {Object.keys(data.reviews).length === 0 ? (
              <p className="text-xs text-slate-500">No reviews recorded yet.</p>
            ) : (
              Object.entries(data.reviews).map(([decision, count]) => (
                <Badge key={decision} tone={decision === 'approved' ? 'success' : 'danger'}>
                  {decision}: {count}
                </Badge>
              ))
            )}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Generation: {data.generation.tasks} tasks · {data.generation.approved} approved ·{' '}
            {data.generation.rejected} returned · avg {data.generation.avgLatencyMs}ms
          </p>
        </Card>

        <Card>
          <p className="mb-2 text-sm font-semibold">Recent AI calls</p>
          <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
            {(usage || []).slice(0, 12).map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate">
                  {row.taskType} · {row.model}
                </span>
                <span className="shrink-0 tabular-nums text-slate-500">
                  {row.cost} {row.currency}
                  {row.status === 'failed' && <span className="ml-1 text-red-500">failed</span>}
                </span>
              </div>
            ))}
            {(usage || []).length === 0 && <p className="text-xs text-slate-500">No calls recorded yet.</p>}
          </div>
        </Card>
      </div>
    </div>
  );
}