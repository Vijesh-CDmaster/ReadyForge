import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Clapperboard,
  FileCode2,
  Lightbulb,
  Lock,
  MonitorPlay,
  PackageCheck,
  RefreshCw,
  Rocket,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Loading,
  Modal,
  Progress,
  SectionTitle,
  Textarea,
  cx,
} from '../components/ui';
import { AiSourceBadge } from '../components/widgets';
import { ProtectedVideoPreview } from '../components/ProtectedVideoPreview';

export interface LadderTask {
  id: string;
  taskType: string;
  stage: string | null;
  status: string;
  attempt: number;
  modelProvider: string;
  modelName: string;
  estimatedCost: number;
  actualCost: number;
  latencyMs: number;
  outputText: string;
  error: string | null;
  reviewStatus: string;
  reviewable: boolean;
  reviewComment: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  regenerationNotes: string | null;
  createdByName: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface StageState {
  stage: string;
  label: string;
  estimatedCost: number;
  state: 'approved' | 'awaiting_review' | 'changes_requested' | 'failed' | 'ready' | 'locked';
  blockers: string[];
  task: LadderTask | null;
}

interface LadderPayload {
  currentStage: string;
  projectStatus: string;
  budget: { amount: number; currency: string; spent: number; remaining: number };
  contract: { id: string; version: number; status: string; approvedAt: string | null; sceneCount: number; hasScript: boolean } | null;
  blockers: string[];
  stages: StageState[];
  tasks: LadderTask[];
}

const STAGE_ICONS: Record<string, typeof Lightbulb> = {
  concept: Lightbulb,
  script: FileCode2,
  storyboard: Clapperboard,
  preview: MonitorPlay,
  final: Rocket,
};

const STATE_META: Record<StageState['state'], { label: string; tone: 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand'; icon: typeof Lightbulb }> = {
  approved: { label: 'Approved', tone: 'success', icon: CheckCircle2 },
  awaiting_review: { label: 'Awaiting review', tone: 'warning', icon: MonitorPlay },
  changes_requested: { label: 'Changes requested', tone: 'warning', icon: RefreshCw },
  failed: { label: 'Generation failed', tone: 'danger', icon: XCircle },
  ready: { label: 'Ready to generate', tone: 'brand', icon: Rocket },
  locked: { label: 'Locked', tone: 'neutral', icon: Lock },
};

const money = (v: number, currency: string) => `${currency} ${v.toLocaleString('en-IN')}`;

export default function DraftLadder() {
  const { projectId = '' } = useParams();
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ladder', projectId],
    queryFn: () => api.get<LadderPayload>(`/api/projects/${projectId}/ladder`),
    enabled: Boolean(projectId),
    refetchInterval: false,
  });

  const { data: autopsy } = useQuery({
    queryKey: ['autopsy', projectId],
    queryFn: () =>
      api.get<{
        cases: Array<{
          id: string;
          stage: string;
          decision: string;
          reviewer: string;
          comment: string;
          rootCause: string;
          whatWasGenerated: string;
          whatChanged: string | null;
          prevention: string;
          createdAt: string;
        }>;
        summary: string;
      }>(`/api/projects/${projectId}/autopsy`),
    enabled: Boolean(projectId),
  });

  const { data: videoJobs } = useQuery({
    queryKey: ['video-jobs', projectId],
    queryFn: () =>
      api.get<{
        jobs: Array<{
          id: string;
          status: string;
          progress: number;
          currentStage: string;
          errorMessage: string | null;
          mockOutput: boolean;
          outputAssetId: string | null;
          retryCount: number;
          maxAttempts: number;
        }>;
      }>(
        `/api/projects/${projectId}/video-jobs`
      ),
    enabled: Boolean(projectId),
    refetchInterval: (query) =>
      query.state.data?.jobs.some((job) => job.status === 'queued' || job.status === 'running') ? 1000 : false,
  });

  const [reviewTask, setReviewTask] = useState<LadderTask | null>(null);
  const [comment, setComment] = useState('');
  const [regenStage, setRegenStage] = useState<StageState | null>(null);
  const [notes, setNotes] = useState('');
  const [viewTask, setViewTask] = useState<LadderTask | null>(null);
  const mockVideo = useMutation({
    mutationFn: () =>
      api.postWithHeaders<{ job: { id: string } }>(
        `/api/projects/${projectId}/video-jobs`,
        { stage: 'final', mode: 'success' },
        { 'Idempotency-Key': `mock-video-${projectId}-${Date.now()}` }
      ),
    onSuccess: () => {
      toast.success('Mock video job queued — output will be clearly labelled');
      void queryClient.invalidateQueries({ queryKey: ['video-jobs', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });
  const retryVideo = useMutation({
    mutationFn: (id: string) => api.post<{ job: { id: string } }>(`/api/video-jobs/${id}/retry`),
    onSuccess: () => {
      toast.success('Video job retry queued');
      void queryClient.invalidateQueries({ queryKey: ['video-jobs', projectId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['ladder', projectId] });
    queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const generate = useMutation({
    mutationFn: (vars: { stage: string; notes?: string }) =>
      api.post<{ task: LadderTask }>(`/api/projects/${projectId}/generate`, vars),
    onSuccess: (_r, vars) => {
      toast.success(`${data?.stages.find((s) => s.stage === vars.stage)?.label || 'Output'} generated — awaiting review`);
      setRegenStage(null);
      setNotes('');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const review = useMutation({
    mutationFn: (vars: { id: string; decision: string; comment?: string }) =>
      api.post<{ projectStatus: string }>(`/api/tasks/${vars.id}/review`, {
        decision: vars.decision,
        comment: vars.comment,
      }),
    onSuccess: (_r, vars) => {
      toast.success(vars.decision === 'approved' ? 'Output approved — next rung unlocked' : 'Decision recorded');
      setReviewTask(null);
      setComment('');
      invalidate();
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading draft ladder…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const { contract, budget, stages, tasks, blockers } = data;
  const base = `/app/projects/${projectId}`;

  if (!contract) {
    return (
      <EmptyState
        icon={<ShieldAlert className="h-6 w-6" />}
        title="No Production Contract yet"
        description="Generation starts only after a contract exists and is approved — that is the ReadyForge rule."
        action={
          <Link to={`${base}/contract`}>
            <Button variant="primary">Create the Production Contract</Button>
          </Link>
        }
      />
    );
  }

  const openReview = (task: LadderTask) => {
    setComment('');
    setReviewTask(task);
  };

  const openRegen = (stage: StageState) => {
    setNotes('');
    setRegenStage(stage);
  };

  const sendDecision = (decision: 'approved' | 'rejected' | 'changes_requested') => {
    if (!reviewTask) return;
    if (decision !== 'approved' && comment.trim().length < 3) {
      toast.error('A reason is required when rejecting or requesting changes');
      return;
    }
    review.mutate({ id: reviewTask.id, decision, comment: comment.trim() || undefined });
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Draft ladder"
        subtitle="Move from concept to final through reviewable, budget-aware production stages."
        action={<Badge tone={contract.status === 'approved' ? 'success' : 'warning'}><Lock className="h-3 w-3" /> Contract {contract.status}</Badge>}
      />
      {/* contract + budget header */}
      <Card className="flex flex-wrap items-center justify-between gap-4 border-brand-200/70 bg-brand-50/20 p-5 dark:border-brand-500/20 dark:bg-brand-950/10">
        <div>
          <div className="flex items-center gap-2">
            <Badge tone={contract.status === 'approved' ? 'success' : 'warning'}>
              Contract v{contract.version} · {contract.status}
            </Badge>
            <Badge tone="neutral">Stage: {data.currentStage}</Badge>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            Every rung must be generated, reviewed and approved before the next unlocks.
          </p>
        </div>
        <div className="w-full max-w-xs">
          <div className="mb-1 flex justify-between text-xs text-slate-500">
            <span>
              {money(budget.spent, budget.currency)} spent
            </span>
            <span>
              {money(budget.remaining, budget.currency)} left
            </span>
          </div>
          <Progress value={budget.amount ? Math.min(100, (budget.spent / budget.amount) * 100) : 0} />
        </div>
      </Card>

      {blockers.length > 0 && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
            <ShieldAlert className="h-4 w-4" /> {blockers.length} blocker(s) keep generation closed
          </p>
          <ul className="list-inside list-disc space-y-1 text-xs text-amber-800 dark:text-amber-200">
            {blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </Card>
      )}

      {contract && (contract.status === 'approved' || contract.status === 'locked') && (
        <Card className="border-brand-200 bg-brand-50/40 dark:border-brand-500/25 dark:bg-brand-500/5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Asynchronous mock video</p>
              <p className="mt-1 text-xs text-slate-500">Test-only output; not a playable MP4 or approved production result.</p>
              {videoJobs?.jobs[0] && (
                <div className="mt-2 space-y-2 text-xs text-brand-700">
                  <p>
                    {videoJobs.jobs[0].status} · {videoJobs.jobs[0].progress}% · {videoJobs.jobs[0].currentStage}
                    {videoJobs.jobs[0].errorMessage ? ` — ${videoJobs.jobs[0].errorMessage}` : ''}
                  </p>
                  {videoJobs.jobs[0].status === 'failed' &&
                    videoJobs.jobs[0].retryCount < videoJobs.jobs[0].maxAttempts && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={retryVideo.isPending}
                        onClick={() => retryVideo.mutate(videoJobs.jobs[0].id)}
                      >
                        Retry video job
                      </Button>
                    )}
                  {videoJobs.jobs[0].status === 'succeeded' && videoJobs.jobs[0].outputAssetId && !videoJobs.jobs[0].mockOutput && (
                    <ProtectedVideoPreview
                      assetId={videoJobs.jobs[0].outputAssetId}
                      label="Generated video preview"
                    />
                  )}
                  {videoJobs.jobs[0].status === 'succeeded' && videoJobs.jobs[0].mockOutput && (
                    <p className="text-amber-700">Mock output is a placeholder and cannot be played as a video.</p>
                  )}
                </div>
              )}
            </div>
            <Button size="sm" onClick={() => mockVideo.mutate()} loading={mockVideo.isPending}>
              Queue mock video
            </Button>
          </div>
        </Card>
      )}

      {/* ladder */}
      <div className="space-y-3">
        {stages.map((stage, i) => {
          const meta = STATE_META[stage.state];
          const Icon = STAGE_ICONS[stage.stage] || Lightbulb;
          const StateIcon = meta.icon;
          const busy = generate.isPending && generate.variables?.stage === stage.stage;
          return (
            <div key={stage.stage} className="relative pl-9">
              {i < stages.length - 1 && (
                <span className="absolute left-4 top-10 h-[calc(100%-1.5rem)] w-px bg-slate-200 dark:bg-slate-800" />
              )}
              <span
                className={cx(
                  'absolute left-0 top-2 flex h-8 w-8 items-center justify-center rounded-full border',
                  stage.state === 'approved'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950'
                    : stage.state === 'locked'
                      ? 'border-slate-200 bg-slate-50 text-slate-400 dark:border-slate-800 dark:bg-slate-900'
                      : 'border-brand-300 bg-brand-50 text-brand-700 dark:border-brand-800 dark:bg-brand-950'
                )}
              >
                <Icon className="h-4 w-4" />
              </span>

              <Card className={cx(stage.state === 'locked' && 'opacity-80')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{stage.label}</h3>
                      <Badge tone={meta.tone}>
                        <StateIcon className="mr-1 inline h-3 w-3" />
                        {meta.label}
                      </Badge>
                      {stage.task && (
                        <Badge tone="neutral">attempt {stage.task.attempt}</Badge>
                      )}
                      <Badge tone="neutral">est. {money(stage.estimatedCost, budget.currency)}</Badge>
                    </div>

                    {stage.task && (
                      <p className="mt-1 truncate text-xs text-slate-500">
                        {stage.task.modelName} · {stage.task.latencyMs}ms ·{' '}
                        {stage.task.actualCost} {budget.currency} actual
                        {stage.task.reviewedByName && ` · reviewed by ${stage.task.reviewedByName}`}
                        {stage.task.regenerationNotes && ` · note: ${stage.task.regenerationNotes}`}
                      </p>
                    )}
                    {stage.task?.reviewComment && stage.task.reviewStatus !== 'approved' && (
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                        “{stage.task.reviewComment}”
                      </p>
                    )}
                    {stage.task?.error && (
                      <p className="mt-1 text-xs text-red-600">{stage.task.error}</p>
                    )}

                    {stage.state === 'locked' && stage.blockers.length > 0 && (
                      <ul className="mt-2 list-inside list-disc space-y-0.5 text-xs text-slate-500">
                        {stage.blockers.slice(0, 4).map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {stage.state === 'ready' && (
                      <Button
                        variant="primary"
                        size="sm"
                        disabled={busy}
                        onClick={() => generate.mutate({ stage: stage.stage })}
                      >
                        {busy ? 'Generating…' : `Generate · est. ${stage.estimatedCost}`}
                      </Button>
                    )}
                    {stage.state === 'awaiting_review' && stage.task && (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setViewTask(stage.task)}>
                          View output
                        </Button>
                        <Button variant="primary" size="sm" onClick={() => openReview(stage.task!)}>
                          Review
                        </Button>
                      </>
                    )}
                    {stage.state === 'changes_requested' && (
                      <Button variant="primary" size="sm" onClick={() => openRegen(stage)}>
                        <RefreshCw className="mr-1 h-3.5 w-3.5" /> Regenerate
                      </Button>
                    )}
                    {stage.state === 'failed' && (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => generate.mutate({ stage: stage.stage, notes: 'Retrying after failure' })}
                      >
                        Retry
                      </Button>
                    )}
                    {stage.state === 'approved' && stage.task && (
                      <Button size="sm" variant="secondary" onClick={() => setViewTask(stage.task)}>
                        View output
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            </div>
          );
        })}
      </div>

      {/* task history */}
      <div>
        <SectionTitle
          title="Generation history"
          subtitle="Every attempt, model, cost and decision — the audit trail behind the ladder."
        />
        {tasks.length === 0 ? (
          <EmptyState title="No generations yet" description="Generate the concept outline to start the ladder." />
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-xs">
              <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-2 font-medium">When</th>
                  <th className="px-4 py-2 font-medium">Rung</th>
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-4 py-2 font-medium">Cost</th>
                  <th className="px-4 py-2 font-medium">Latency</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Decision</th>
                  <th className="px-4 py-2 font-medium" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tasks.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-2 text-slate-500">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="px-4 py-2">
                      {t.stage || 'verification'}
                      {t.attempt > 1 && <span className="text-slate-400"> · #{t.attempt}</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-1">
                        <span className="truncate">{t.modelName}</span>
                        <AiSourceBadge source={t.modelProvider === 'local-llm' ? 'ai' : 'rule_engine'} model={t.modelName} />
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      {t.actualCost} {budget.currency}
                    </td>
                    <td className="px-4 py-2">{t.latencyMs}ms</td>
                    <td className="px-4 py-2">
                      <Badge tone={t.status === 'failed' ? 'danger' : t.status === 'requires_approval' ? 'warning' : 'success'}>
                        {t.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-2">
                      <Badge
                        tone={
                          t.reviewStatus === 'approved' ? 'success' : t.reviewStatus === 'pending' ? 'neutral' : 'danger'
                        }
                      >
                        {t.reviewable ? t.reviewStatus : 'report'}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <button
                        className="text-brand-600 hover:underline"
                        onClick={() => setViewTask(t)}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </div>

      {/* regeneration autopsy */}
      {autopsy && autopsy.cases.length > 0 && (
        <div>
          <SectionTitle
            title="Regeneration Autopsy"
            subtitle={autopsy.summary}
          />
          <div className="grid gap-4 lg:grid-cols-2">
            {autopsy.cases.map((c) => (
              <Card key={c.id} className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold capitalize">Rejected: {c.stage}</p>
                  <Badge tone="danger">{c.decision}</Badge>
                </div>
                <dl className="mt-3 space-y-2 text-xs">
                  <div>
                    <dt className="font-medium text-slate-500">What was generated</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{c.whatWasGenerated}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Why it was rejected</dt>
                    <dd className="text-slate-700 dark:text-slate-300">{c.comment || 'No comment recorded.'}</dd>
                  </div>
                  <div>
                    <dt className="font-medium text-slate-500">Root cause</dt>
                    <dd className="rounded-md bg-rose-50 px-2 py-1.5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                      {c.rootCause}
                    </dd>
                  </div>
                  {c.whatChanged && (
                    <div>
                      <dt className="font-medium text-slate-500">What changed</dt>
                      <dd className="text-slate-700 dark:text-slate-300">{c.whatChanged}</dd>
                    </div>
                  )}
                  <div>
                    <dt className="font-medium text-slate-500">Prevention</dt>
                    <dd className="rounded-md bg-emerald-50 px-2 py-1.5 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                      {c.prevention}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] text-slate-400">
                  Reviewed by {c.reviewer} · {new Date(c.createdAt).toLocaleString()}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* output viewer */}
      <Modal open={Boolean(viewTask)} onClose={() => setViewTask(null)} title={viewTask ? `${viewTask.taskType} output · attempt ${viewTask.attempt}` : ''}>
        {viewTask && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{viewTask.modelName}</Badge>
              <Badge tone="neutral">{viewTask.latencyMs}ms</Badge>
              <Badge tone={viewTask.reviewStatus === 'approved' ? 'success' : 'neutral'}>{viewTask.reviewStatus}</Badge>
              {viewTask.reviewable && (
                <Link to={`${base}/${viewTask.stage === 'concept' ? 'script' : viewTask.stage === 'storyboard' ? 'storyboard' : 'script'}`} className="text-xs text-brand-600 hover:underline">
                  Open in editor →
                </Link>
              )}
            </div>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {viewTask.outputText || viewTask.error || 'No output captured.'}
            </pre>
            {viewTask.reviewable && viewTask.status === 'requires_approval' && (
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" onClick={() => { setViewTask(null); openReview(viewTask); }}>
                  Review this output
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* review modal */}
      <Modal open={Boolean(reviewTask)} onClose={() => setReviewTask(null)} title="Review generated output">
        {reviewTask && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {reviewTask.taskType} · attempt {reviewTask.attempt} · generated by {reviewTask.createdByName || 'unknown'}
            </p>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
              {reviewTask.outputText}
            </pre>
            <Field label="Comment" hint="Required when rejecting or requesting changes">
              <Textarea
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What is right or wrong with this output?"
              />
            </Field>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => sendDecision('rejected')} disabled={review.isPending}>
                Reject
              </Button>
              <Button variant="secondary" size="sm" onClick={() => sendDecision('changes_requested')} disabled={review.isPending}>
                Request changes
              </Button>
              <Button variant="primary" size="sm" onClick={() => sendDecision('approved')} disabled={review.isPending}>
                Approve
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* regenerate modal (rejection needs a resolution — spec rule 10) */}
      <Modal open={Boolean(regenStage)} onClose={() => setRegenStage(null)} title={`Regenerate ${regenStage?.label || ''}`}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Estimated cost {regenStage?.estimatedCost} {budget.currency} · this rung was returned for changes, so record what
            changed before regenerating.
          </p>
          <Field label="Resolution notes" hint="What did you change or fix?">
            <Textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Removed the unapproved 10x claim and shortened scene 3."
            />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRegenStage(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={generate.isPending || notes.trim().length < 3}
              onClick={() => regenStage && generate.mutate({ stage: regenStage.stage, notes: notes.trim() })}
            >
              {generate.isPending ? 'Generating…' : 'Regenerate'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}