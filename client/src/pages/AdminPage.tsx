import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Users, Boxes, Activity, Coins } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Card, ErrorBox, Loading, SectionTitle } from '../components/ui';
import { useAuthStore } from '../store/auth';

interface AdminStats {
  users: number;
  workspaces: number;
  projects: { total: number; byStatus: Record<string, number> };
  ai: { runs: number; failures: number; totalCost: number };
  recentActivity: Array<{ id: string; action: string; entityType: string; actor: string; at: string }>;
  note: string;
}

/** Platform admin dashboard (spec §26.1) — read-only, admin-gated on the server. */
export default function AdminPage() {
  const me = useAuthStore((s) => s.user);
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => api.get<AdminStats>('/api/admin/stats'),
    retry: false,
  });

  if (me?.platformRole !== 'admin') {
    return (
      <Card className="p-6">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          This page is restricted to platform administrators. Your account role is <strong>{me?.platformRole ?? 'unknown'}</strong>.
        </p>
      </Card>
    );
  }
  if (isLoading) return <Loading label="Loading platform stats…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const cards = [
    { label: 'Users', value: String(data.users), icon: Users, tone: 'text-sky-500' },
    { label: 'Workspaces', value: String(data.workspaces), icon: Boxes, tone: 'text-brand-500' },
    { label: 'Projects', value: String(data.projects.total), icon: Activity, tone: 'text-emerald-500' },
    {
      label: 'AI spend',
      value: `${data.ai.totalCost}`,
      icon: Coins,
      tone: 'text-amber-500',
      hint: `${data.ai.runs} runs · ${data.ai.failures} failed`,
    },
  ];

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <SectionTitle title="Platform admin" subtitle="Read-only operational view of ReadyForge usage and audit activity." action={<Badge tone="brand"><ShieldCheck className="h-3 w-3" /> admin only</Badge>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="p-5">
            <div className="flex items-center gap-2">
              <c.icon className={`h-4 w-4 ${c.tone}`} aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">{c.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{c.value}</p>
            {c.hint && <p className="text-xs text-slate-500">{c.hint}</p>}
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <SectionTitle title="Projects by status" subtitle="Where the platform's work is sitting right now." />
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.projects.byStatus)
            .filter(([, count]) => count > 0)
            .map(([status, count]) => (
              <Badge key={status} tone="neutral">
                {status}: {count}
              </Badge>
            ))}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle title="Recent platform activity" subtitle="Tail of the immutable audit trail." />
        <ul className="divide-y divide-slate-100 dark:divide-slate-800">
          {data.recentActivity.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2 text-sm">
              <span className="font-mono text-xs text-slate-500">{a.action}</span>
              <span className="text-slate-400">{a.entityType}</span>
              <span className="flex-1 text-right text-xs text-slate-400">
                {a.actor} · {new Date(a.at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-slate-400">{data.note}</p>
      </Card>
    </div>
  );
}
