import { NavLink, Outlet, useParams } from 'react-router-dom';
import { BookOpen, ListChecks, Sparkles } from 'lucide-react';
import { Badge, Card, cx } from '../components/ui';
import { useProject } from './ProjectLayout';

export default function KnowledgeLayout() {
  const { projectId = '' } = useParams();
  const { data: project } = useProject();
  const base = `/app/projects/${projectId}/knowledge`;
  const totalInputs = Object.values(project?.inputCounts || {}).reduce((a, b) => a + b, 0);

  const links = [
    { to: base, end: true, label: 'Overview', description: 'Knowledge health and next steps', icon: BookOpen },
    { to: `${base}/inputs`, label: 'AI wizard', description: 'Collect missing project context', icon: Sparkles },
    { to: `${base}/ledger`, label: `Ledger (${totalInputs})`, description: 'Review and manage inputs', icon: ListChecks },
  ];

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <Card className="h-fit p-2 lg:sticky lg:top-5">
        <div className="px-3 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-brand-600 dark:text-brand-300" />
            <h2 className="text-sm font-semibold">Knowledge</h2>
            <Badge tone="neutral">{totalInputs}</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">The source of truth for this project.</p>
        </div>
        <nav className="space-y-1" aria-label="Knowledge pages">
          {links.map(({ to, end, label, description, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100'
                )
              }
            >
              <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-[11px] leading-4 text-slate-500 dark:text-slate-400">{description}</span>
              </span>
            </NavLink>
          ))}
        </nav>
      </Card>

      <div className="min-w-0">
        <Outlet />
      </div>
    </div>
  );
}
