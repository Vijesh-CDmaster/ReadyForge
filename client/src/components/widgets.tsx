import { AlertTriangle, ShieldCheck, Sparkles, Calculator, ArrowRight } from 'lucide-react';
import { Badge, Card, Progress, cx } from './ui';

/* project status → tone */
export function StatusBadge({ status }: { status: string }) {
  const tone =
    status === 'ready' || status === 'approved' || status === 'published'
      ? 'success'
      : status === 'blocked' || status === 'contract_review'
        ? 'danger'
        : ['validation', 'generating', 'review'].includes(status)
          ? 'warning'
          : 'neutral';
  return <Badge tone={tone}>{status.replace('_', ' ')}</Badge>;
}

export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === 'critical' ? 'danger' : severity === 'high' ? 'warning' : 'neutral';
  return <Badge tone={tone}>{severity}</Badge>;
}

export function AiSourceBadge({ source, model }: { source?: string; model?: string }) {
  if (!source) return null;
  const ai = source === 'ai';
  return (
    <Badge tone={ai ? 'brand' : 'neutral'}>
      <span title={model} className="inline-flex items-center gap-1">
        {ai ? <Sparkles className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
        {ai ? `AI-assisted${model ? ` · ${model}` : ''}` : 'Rule engine (deterministic)'}
      </span>
    </Badge>
  );
}

/* Readiness meter */
export function ReadinessMeter({ score, compact }: { score: number; compact?: boolean }) {
  const tone = score >= 75 ? 'success' : score >= 50 ? 'warning' : 'danger';
  const color = tone === 'success' ? 'text-emerald-600' : tone === 'warning' ? 'text-amber-600' : 'text-rose-600';
  return (
    <div className={cx('flex items-center gap-3', compact && 'gap-2')}>
      <div className={cx('font-bold tabular-nums', color, compact ? 'text-lg' : 'text-2xl')}>{Math.round(score)}</div>
      <div className="flex-1">
        <Progress value={score} tone={tone} />
        {!compact && (
          <p className="mt-1 text-xs text-slate-500">
            {score >= 75 ? 'Ready to generate' : score >= 50 ? 'Getting ready — resolve warnings' : 'Not ready — blockers likely'}
          </p>
        )}
      </div>
    </div>
  );
}

/* Cost-at-risk card */
export function CostAtRiskCard({
  data,
  onAction,
  actionLabel,
}: {
  data?: {
    plannedCost: number;
    reworkProbability: number;
    estimatedLoss: number;
    currency: string;
    reasons: string[];
    recommendedActions: string[];
    nextStage: string;
    disclaimer: string;
  } | null;
  onAction?: () => void;
  actionLabel?: string;
}) {
  if (!data) return null;
  const pct = Math.round(data.reworkProbability * 100);
  const risky = pct >= 40;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Calculator className="h-4 w-4 text-brand-500" />
        Cost at Risk — {data.nextStage}
        <Badge tone="neutral">estimate</Badge>
      </div>

      <p className={cx('mt-3 text-sm leading-relaxed', risky ? 'text-rose-700 dark:text-rose-300' : 'text-emerald-700 dark:text-emerald-300')}>
        <strong>
          Rendering now: {pct}% chance of rework. {data.currency} {data.estimatedLoss.toLocaleString('en-IN')} at risk.
        </strong>{' '}
        Planned cost {data.currency} {data.plannedCost.toLocaleString('en-IN')}.
      </p>

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-slate-500">
          <span>Rework probability</span>
          <span className="font-semibold tabular-nums">{pct}%</span>
        </div>
        <Progress value={pct} tone={risky ? 'danger' : 'success'} />
      </div>

      <ul className="mt-3 space-y-1 text-xs text-slate-600 dark:text-slate-400">
        {data.reasons.slice(0, 4).map((r, i) => (
          <li key={i} className="flex gap-1.5">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
            {r}
          </li>
        ))}
      </ul>

      {data.recommendedActions.length > 0 && (
        <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-800/60">
          <p className="mb-1 font-semibold">Reduce risk</p>
          {data.recommendedActions.slice(0, 2).map((a, i) => (
            <p key={i} className="text-slate-600 dark:text-slate-300">• {a}</p>
          ))}
        </div>
      )}

      {onAction && (
        <button onClick={onAction} className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline">
          {actionLabel || 'Open Cost-at-Risk dashboard'} <ArrowRight className="h-3 w-3" />
        </button>
      )}

      <p className="mt-3 text-[10px] italic text-slate-400">{data.disclaimer}</p>
    </Card>
  );
}

/* Conflict card */
export function ConflictCard({
  conflict,
  onOpen,
}: {
  conflict: {
    id: string;
    title: string;
    description: string;
    severity: string;
    status: string;
    conflictType: string;
    inputA?: { title?: string; content?: string } | null;
    inputB?: { title?: string; content?: string } | null;
    assignedTo?: { name?: string; email?: string } | null;
    recommendedAction?: string;
    impactIfUnresolved?: string;
    resolution?: string;
  };
  onOpen?: () => void;
}) {
  const closed = conflict.status === 'resolved' || conflict.status === 'dismissed';
  return (
    <Card className={cx('p-4', closed && 'opacity-75')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <SeverityBadge severity={conflict.severity} />
          <Badge tone="neutral">{conflict.conflictType}</Badge>
          <Badge tone={closed ? 'success' : 'warning'}>{conflict.status.replace('_', ' ')}</Badge>
        </div>
        {conflict.assignedTo && (
          <span className="text-xs text-slate-500">→ {conflict.assignedTo.name || conflict.assignedTo.email}</span>
        )}
      </div>

      <h4 className="mt-2 text-sm font-semibold">{conflict.title}</h4>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{conflict.description}</p>

      {(conflict.inputA || conflict.inputB) && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[conflict.inputA, conflict.inputB].filter(Boolean).map((input, i) => (
            <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs dark:border-slate-700 dark:bg-slate-800/60">
              <p className="font-semibold">{input!.title}</p>
              <p className="mt-0.5 text-slate-600 dark:text-slate-400">{input!.content}</p>
            </div>
          ))}
        </div>
      )}

      {conflict.recommendedAction && !closed && (
        <p className="mt-3 text-xs text-brand-600 dark:text-brand-300">→ {conflict.recommendedAction}</p>
      )}
      {conflict.impactIfUnresolved && !closed && (
        <p className="mt-1 text-xs text-slate-500">Impact if unresolved: {conflict.impactIfUnresolved}</p>
      )}
      {conflict.resolution && (
        <p className="mt-3 rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200">
          Resolution: {conflict.resolution}
        </p>
      )}

      {onOpen && !closed && (
        <button onClick={onOpen} className="mt-3 text-xs font-medium text-brand-600 hover:underline">
          Open in Conflict Room →
        </button>
      )}
    </Card>
  );
}
