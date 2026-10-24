import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { GitMerge, ScanSearch, Sparkles, MessageSquare } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Loading,
  Modal,
  Select,
  Textarea,
} from '../components/ui';
import { ConflictCard, AiSourceBadge } from '../components/widgets';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface Recommendation {
  optionA: { id: string; content: string; creatorRole: string | null } | null;
  optionB: { id: string; content: string; creatorRole: string | null } | null;
  recommended: 'A' | 'B' | null;
  reason: string;
}

interface ConflictRow {
  id: string;
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  status: 'open' | 'awaiting_decision' | 'resolved' | 'dismissed';
  conflictType: string;
  detectedBy: string;
  inputA: { id: string; title?: string; content?: string; status?: string } | null;
  inputB: { id: string; title?: string; content?: string; status?: string } | null;
  assignedTo: { id: string; name?: string; email?: string } | null;
  recommendedAction?: string;
  impactIfUnresolved?: string;
  resolution?: string;
  resolvedBy?: string;
}

interface DetectResponse {
  conflicts: ConflictRow[];
  detectedCount: number;
  createdCount: number;
  aiSource: string;
  model: string;
}

export default function ConflictRoom() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [resolving, setResolving] = useState<ConflictRow | null>(null);
  const [resolution, setResolution] = useState('');
  const [inputAction, setInputAction] = useState<Record<string, 'none' | 'approve' | 'reject'>>({});
  const [dismissTarget, setDismissTarget] = useState<ConflictRow | null>(null);
  const [dismissReason, setDismissReason] = useState('');
  const [lastDetect, setLastDetect] = useState<DetectResponse | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['conflicts', project?.id],
    queryFn: () => api.get<ConflictRow[]>(`/api/projects/${project!.id}/conflicts`),
    enabled: Boolean(project?.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['conflicts', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['inputs', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['cost-at-risk', project?.id] });
  };

  const detect = useMutation({
    mutationFn: () => api.post<DetectResponse>(`/api/projects/${project!.id}/conflicts/detect`),
    onSuccess: (res) => {
      setLastDetect(res);
      toast.success(`Detected ${res.detectedCount} issue(s) — ${res.createdCount} new conflict(s) created`);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const resolve = useMutation({
    mutationFn: () => {
      const inputActions = Object.entries(inputAction)
        .filter(([, action]) => action !== 'none')
        .map(([inputId, action]) => ({ inputId, action }));
      return api.patch(`/api/conflicts/${resolving!.id}/resolve`, { resolution, inputActions });
    },
    onSuccess: () => {
      toast.success('Conflict resolved and audit-logged');
      setResolving(null);
      setResolution('');
      setInputAction({});
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const dismiss = useMutation({
    mutationFn: () => api.patch(`/api/conflicts/${dismissTarget!.id}/dismiss`, { reason: dismissReason }),
    onSuccess: () => {
      toast.success('Conflict dismissed');
      setDismissTarget(null);
      setDismissReason('');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // One-click recommendation for the conflict currently open in the modal.
  const { data: recommendation } = useQuery({
    queryKey: ['conflict-rec', resolving?.id],
    queryFn: () => api.get<Recommendation>(`/api/conflicts/${resolving!.id}/recommendation`),
    enabled: Boolean(resolving?.id),
  });

  const acceptRecommendation = useMutation({
    mutationFn: () =>
      api.patch<{ ok: boolean; recommended: 'A' | 'B'; reason: string }>(
        `/api/conflicts/${resolving!.id}/accept-recommendation`
      ),
    onSuccess: (res) => {
      toast.success(`Conflict resolved via recommendation (Option ${res.recommended})`);
      setResolving(null);
      setResolution('');
      setInputAction({});
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const [discussMode, setDiscussMode] = useState(false);

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading conflicts…" />;
  if (error) return <ErrorBox error={error} />;

  const conflicts = data || [];
  const open = conflicts.filter((c) => c.status === 'open' || c.status === 'awaiting_decision');
  const closed = conflicts.filter((c) => c.status === 'resolved' || c.status === 'dismissed');

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="flex items-center gap-3">
          <GitMerge className="h-5 w-5 text-brand-500" />
          <div>
            <p className="text-sm font-semibold">Consensus Graph — Conflict Room</p>
            <p className="text-xs text-slate-500">
              {open.length} open · {closed.length} closed — contradictions are routed to the right decision-maker.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastDetect && <AiSourceBadge source={lastDetect.aiSource} model={lastDetect.model} />}
          <Button onClick={() => detect.mutate()} loading={detect.isPending}>
            <ScanSearch className="h-4 w-4" /> Detect conflicts
          </Button>
        </div>
      </Card>

      {/* Open conflicts */}
      {open.length === 0 ? (
        <Card className="px-6 py-12 text-center">
          <p className="text-sm font-semibold">No open conflicts</p>
          <p className="mt-1 text-sm text-slate-500">
            Run detection after adding inputs to catch contradictions, unsupported claims and rights risks.
          </p>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {open.map((c) => (
            <ConflictCard
              key={c.id}
              conflict={c}
              onOpen={() => {
                setResolving(c);
                setResolution(c.recommendedAction ? '' : '');
                setInputAction({});
                setDiscussMode(false);
              }}
            />
          ))}
        </div>
      )}

      {/* Closed */}
      {closed.length > 0 && (
        <div>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Resolved & dismissed</h3>
          <div className="grid gap-4 lg:grid-cols-2">
            {closed.map((c) => (
              <ConflictCard key={c.id} conflict={c} />
            ))}
          </div>
        </div>
      )}

      {/* Resolve modal */}
      <Modal
        open={Boolean(resolving)}
        onClose={() => setResolving(null)}
        title={`Resolve: ${resolving?.title || ''}`}
        wide
        footer={
          <>
            {resolving && (
              <Button variant="ghost" onClick={() => setDismissTarget(resolving)}>
                Dismiss instead
              </Button>
            )}
            <Button variant="ghost" onClick={() => setResolving(null)}>Cancel</Button>
            <Button
              loading={resolve.isPending}
              disabled={resolution.trim().length < 3}
              onClick={() => resolve.mutate()}
            >
              Record decision
            </Button>
          </>
        }
      >
        {resolving && (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400">{resolving.description}</p>

            {/* One-click recommendation */}
            {recommendation?.recommended && !discussMode && (
              <div className="my-3 rounded-lg border border-brand-200 bg-brand-50/60 p-4 dark:border-brand-800 dark:bg-brand-500/10">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand-600 dark:text-brand-300" />
                  <p className="text-xs font-semibold uppercase tracking-wider text-brand-700 dark:text-brand-300">
                    Recommended: Option {recommendation.recommended}
                  </p>
                </div>
                <div className="mt-2 rounded-lg bg-white/70 p-3 text-xs text-slate-700 dark:bg-slate-900/50 dark:text-slate-300">
                  <p className="font-mono">{recommendation.recommended === 'A' ? recommendation.optionA?.content : recommendation.optionB?.content}</p>
                </div>
                <p className="mt-2 text-xs text-slate-600 dark:text-slate-400">{recommendation.reason}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={acceptRecommendation.isPending} onClick={() => acceptRecommendation.mutate()}>
                    Accept recommendation
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const keep = recommendation.recommended === 'A' ? recommendation.optionB : recommendation.optionA;
                      if (keep) {
                        setInputAction({ [keep.id]: 'approve' });
                        setResolution(`Keeping Option ${recommendation.recommended === 'A' ? 'B' : 'A'}: ${keep.content}`);
                      }
                      setDiscussMode(true);
                    }}
                  >
                    Keep Option {recommendation.recommended === 'A' ? 'B' : 'A'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDiscussMode(true)}>
                    <MessageSquare className="h-3.5 w-3.5" /> Discuss
                  </Button>
                </div>
              </div>
            )}

            <div className="my-3 grid gap-2 sm:grid-cols-2">
              {[resolving.inputA, resolving.inputB].filter(Boolean).map((input, i) => (
                <div key={i} className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/60">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">{input!.title}</p>
                    <Badge tone="neutral">{input!.status}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">{input!.content}</p>
                  <div className="mt-2">
                    <Select
                      value={inputAction[input!.id] || 'none'}
                      onChange={(e) =>
                        setInputAction((m) => ({
                          ...m,
                          [input!.id]: e.target.value as 'none' | 'approve' | 'reject',
                        }))
                      }
                    >
                      <option value="none">Leave as is</option>
                      <option value="approve">Approve this input</option>
                      <option value="reject">Reject this input</option>
                    </Select>
                  </div>
                </div>
              ))}
            </div>

            <Textarea
              placeholder="Your written decision — required. e.g. “14-day trial for enterprise plans only.”"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
            />
            <p className="mt-2 text-xs text-slate-500">
              The decision, input changes and your identity are written to the audit trail.
            </p>
            {discussMode && (
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => setDiscussMode(false)}>
                ← Back to recommendation
              </Button>
            )}
          </>
        )}
      </Modal>

      {/* Dismiss modal */}
      <Modal
        open={Boolean(dismissTarget)}
        onClose={() => setDismissTarget(null)}
        title="Dismiss conflict"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDismissTarget(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={dismiss.isPending}
              disabled={dismissReason.trim().length < 3}
              onClick={() => dismiss.mutate()}
            >
              Dismiss
            </Button>
          </>
        }
      >
        <Textarea
          placeholder="Reason for dismissal (required)…"
          value={dismissReason}
          onChange={(e) => setDismissReason(e.target.value)}
        />
      </Modal>
    </div>
  );
}
