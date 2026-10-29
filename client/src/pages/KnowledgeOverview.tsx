import { Link } from 'react-router-dom';
import { ArrowRight, CheckCircle2, ListChecks, Sparkles } from 'lucide-react';
import { Card, SectionTitle } from '../components/ui';
import { useProject } from './ProjectLayout';

export default function KnowledgeOverview() {
  const { data: project } = useProject();
  if (!project) return null;

  const totalInputs = Object.values(project.inputCounts || {}).reduce((a, b) => a + b, 0);
  const base = `/app/projects/${project.id}/knowledge`;

  return (
    <div>
      <SectionTitle
        title="Knowledge overview"
        subtitle="Collect, review, and keep the facts behind this project current."
        action={
          <Link to={`${base}/inputs`} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-700">
            <Sparkles className="h-4 w-4" />
            Start AI wizard
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <KnowledgeStat label="Total inputs" value={totalInputs} icon={<ListChecks className="h-4 w-4" />} />
        <KnowledgeStat label="Project stage" value={project.currentStage} icon={<CheckCircle2 className="h-4 w-4" />} />
        <KnowledgeStat label="Readiness" value={`${Math.round(project.readinessScore)}/100`} icon={<CheckCircle2 className="h-4 w-4" />} />
      </div>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <KnowledgeCard
          href={`${base}/inputs`}
          icon={<Sparkles className="h-5 w-5" />}
          title="AI wizard"
          description="Answer the highest-priority questions and turn each response into a structured knowledge input."
          action="Continue intake"
        />
        <KnowledgeCard
          href={`${base}/ledger`}
          icon={<ListChecks className="h-5 w-5" />}
          title="Knowledge ledger"
          description="Review status, confidence, source, and freshness before information drives production decisions."
          action="Open ledger"
        />
      </div>
    </div>
  );
}

function KnowledgeStat({ label, value, icon }: { label: string; value: string | number; icon: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-slate-400">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-semibold capitalize">{value}</p>
    </Card>
  );
}

function KnowledgeCard({ href, icon, title, description, action }: { href: string; icon: React.ReactNode; title: string; description: string; action: string }) {
  return (
    <Link to={href} className="group rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-md dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/15 dark:text-brand-300">{icon}</span>
        <ArrowRight className="h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />
      </div>
      <h2 className="mt-4 text-base font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
      <span className="mt-4 inline-block text-sm font-medium text-brand-600 dark:text-brand-300">{action} →</span>
    </Link>
  );
}
