import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSignature, CheckCircle2, XCircle, History, Sparkles, ShieldAlert } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Loading,
  Modal,
  SectionTitle,
  Tabs,
  Textarea,
} from '../components/ui';
import { AiSourceBadge } from '../components/widgets';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface Approval {
  userId: string | { _id: string; name?: string; email?: string };
  role: string;
  status: 'pending' | 'approved' | 'rejected';
  decidedAt?: string;
  comment?: string;
}

interface ContractDoc {
  id: string;
  version: number;
  status: string;
  objective: string;
  audience: string;
  tone: string;
  keyMessage: string;
  callToAction: string;
  approvedClaimIds: Array<{ _id: string; title: string; content: string }>;
  approvedAssetIds: Array<{ _id: string; name: string; licenseStatus: string; fileUrl: string }>;
  brandRules: string[];
  accessibilityRequirements: string[];
  localisationRequirements: string[];
  contentPlan: {
    outline: string[];
    script: string;
    storyboard: Array<{ sceneNumber: number; title: string; description: string; status: string }>;
  };
  modelRoutingPlan: Array<{ task: string; preferredModel: string; fallbackModel: string; estimatedCost: number; reason: string }>;
  budgetLimit: number;
  requiredApprovals: Approval[];
  blockers: string[];
  approvedAt?: string;
  createdAt: string;
}

interface ContractResponse {
  contract: ContractDoc | null;
  history: Array<{ _id: string; version: number; status: string; createdAt: string; approvedAt?: string }>;
}

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'brand'> = {
  approved: 'success',
  locked: 'success',
  pending_approval: 'warning',
  draft: 'neutral',
  rejected: 'danger',
  superseded: 'neutral',
};

export default function ContractPage() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('brief');
  const [decision, setDecision] = useState<'approve' | 'reject' | null>(null);
  const [comment, setComment] = useState('');
  const [aiMeta, setAiMeta] = useState<{ source: string; model: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['contract', project?.id],
    queryFn: () => api.get<ContractResponse>(`/api/projects/${project!.id}/contract`),
    enabled: Boolean(project?.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['contract', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
  };

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ contract: ContractDoc; aiSource: string; model: string }>(
        `/api/projects/${project!.id}/contract`
      ),
    onSuccess: (res) => {
      setAiMeta({ source: res.aiSource, model: res.model });
      toast.success(`Contract v${res.contract.version} created and sent for approval`);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const decide = useMutation({
    mutationFn: () =>
      api.post<{ allApproved?: boolean }>(
        decision === 'approve'
          ? `/api/projects/${project!.id}/contract/approve`
          : `/api/projects/${project!.id}/contract/reject`,
        { comment: comment || undefined }
      ),
    onSuccess: (res) => {
      toast.success(
        decision === 'approve'
          ? res.allApproved
            ? 'Contract fully approved — project is ready for generation'
            : 'Your approval was recorded'
          : 'Contract rejected — regenerate after fixing issues'
      );
      setDecision(null);
      setComment('');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading contract…" />;
  if (error) return <ErrorBox error={error} />;

  const contract = data?.contract || null;

  if (!contract) {
    return (
      <div className="mx-auto max-w-2xl">
        <Card className="flex flex-col items-center px-6 py-14 text-center">
          <FileSignature className="mb-3 h-9 w-9 text-slate-400" />
          <h2 className="text-base font-semibold">No Production Contract yet</h2>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            The contract freezes objective, approved claims, licensed assets, brand rules, storyboard plan,
            model routing and required approvals — using only validated inputs. Generation is blocked until
            it is approved.
          </p>
          <Button className="mt-5" onClick={() => generate.mutate()} loading={generate.isPending}>
            <Sparkles className="h-4 w-4" /> Generate contract from validated inputs
          </Button>
          {project.readinessScore < 50 && (
            <p className="mt-3 text-xs text-amber-600">
              Heads up: readiness is {Math.round(project.readinessScore)}/100 — blockers will be listed inside the contract.
            </p>
          )}
        </Card>
      </div>
    );
  }

  const allApproved = contract.requiredApprovals.length > 0 && contract.requiredApprovals.every((a) => a.status === 'approved');
  const approvedCount = contract.requiredApprovals.filter((a) => a.status === 'approved').length;

  return (
    <div className="space-y-5">
      <SectionTitle
        title={`Production Contract v${contract.version}`}
        subtitle={`Status: ${contract.status.replace('_', ' ')} · created ${new Date(contract.createdAt).toLocaleString()}`}
        action={
          <div className="flex items-center gap-2">
            {aiMeta && <AiSourceBadge source={aiMeta.source} model={aiMeta.model} />}
            <Button variant="outline" onClick={() => generate.mutate()} loading={generate.isPending}>
              New version
            </Button>
            {contract.status === 'pending_approval' && (
              <>
                <Button
                  variant="danger"
                  onClick={() => {
                    setDecision('reject');
                    setComment('');
                  }}
                >
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
                <Button onClick={() => { setDecision('approve'); setComment(''); }}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <ContractStat label="Gate status" value={contract.blockers.length ? 'Blocked' : contract.status.replace('_', ' ')} tone={contract.blockers.length ? 'danger' : contract.status === 'approved' ? 'success' : 'warning'} />
        <ContractStat label="Approvals" value={`${approvedCount}/${contract.requiredApprovals.length}`} tone={allApproved ? 'success' : 'warning'} />
        <ContractStat label="Claims & assets" value={`${contract.approvedClaimIds.length + contract.approvedAssetIds.length}`} tone="brand" />
      </div>

      {/* Blockers banner */}
      {contract.blockers.length > 0 && (
        <Card className="border-rose-300 p-4 dark:border-rose-900">
          <p className="flex items-center gap-2 text-sm font-semibold text-rose-600">
            <ShieldAlert className="h-4 w-4" /> {contract.blockers.length} blocker(s) — generation stays locked until resolved
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-rose-700 dark:text-rose-300">
            {contract.blockers.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Tabs
            active={tab}
            onChange={setTab}
            items={[
              { key: 'brief', label: 'Brief' },
              { key: 'plan', label: 'Content plan' },
              { key: 'routing', label: 'Model routing' },
              { key: 'approvals', label: `Approvals (${contract.requiredApprovals.filter((a) => a.status === 'approved').length}/${contract.requiredApprovals.length})` },
            ]}
            className="mb-4"
          />

          {tab === 'brief' && (
            <div className="space-y-4">
              <Card className="p-5">
                <dl className="grid gap-4 sm:grid-cols-2">
                  <Item label="Objective" value={contract.objective} />
                  <Item label="Audience" value={contract.audience} />
                  <Item label="Tone" value={contract.tone} />
                  <Item label="Call to action" value={contract.callToAction} />
                  <Item label="Key message" value={contract.keyMessage} wide />
                </dl>
              </Card>

              <Card className="p-5">
                <h3 className="text-sm font-semibold">Approved claims ({contract.approvedClaimIds.length})</h3>
                {contract.approvedClaimIds.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No approved claims — generation will fail claim verification.</p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {contract.approvedClaimIds.map((c) => (
                      <li key={c._id} className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200">
                        <strong>{c.title}:</strong> {c.content}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card className="p-5">
                <h3 className="text-sm font-semibold">Approved assets ({contract.approvedAssetIds.length})</h3>
                {contract.approvedAssetIds.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">No licensed assets yet — upload and licence assets first.</p>
                ) : (
                  <ul className="mt-2 space-y-1.5 text-sm">
                    {contract.approvedAssetIds.map((a) => (
                      <li key={a._id} className="flex items-center gap-2">
                        <Badge tone="success">{a.licenseStatus}</Badge> {a.name}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <div className="grid gap-4 sm:grid-cols-2">
                <Card className="p-5">
                  <h3 className="text-sm font-semibold">Brand rules</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                    {contract.brandRules.length ? contract.brandRules.map((r, i) => <li key={i}>{r}</li>) : <li className="list-none italic text-slate-400">None recorded</li>}
                  </ul>
                </Card>
                <Card className="p-5">
                  <h3 className="text-sm font-semibold">Accessibility requirements</h3>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                    {contract.accessibilityRequirements.length ? (
                      contract.accessibilityRequirements.map((r, i) => <li key={i}>{r}</li>)
                    ) : (
                      <li className="list-none italic text-slate-400">None recorded</li>
                    )}
                  </ul>
                </Card>
              </div>
            </div>
          )}

          {tab === 'plan' && (
            <div className="space-y-4">
              <Card className="p-5">
                <h3 className="text-sm font-semibold">Outline</h3>
                <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-slate-600 dark:text-slate-300">
                  {contract.contentPlan.outline.length ? (
                    contract.contentPlan.outline.map((o, i) => <li key={i}>{o}</li>)
                  ) : (
                    <li className="list-none italic text-slate-400">No outline yet</li>
                  )}
                </ol>
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-semibold">Script direction</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-300">
                  {contract.contentPlan.script || <em className="text-slate-400">No script direction yet</em>}
                </p>
              </Card>
              <Card className="p-5">
                <h3 className="text-sm font-semibold">Storyboard plan</h3>
                {contract.contentPlan.storyboard.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    Storyboard scenes are created in the Draft Ladder (Phase 4 — generation).
                  </p>
                ) : (
                  <ul className="mt-2 space-y-2">
                    {contract.contentPlan.storyboard.map((s) => (
                      <li key={s.sceneNumber} className="rounded-lg bg-slate-50 px-3 py-2 text-sm dark:bg-slate-800/60">
                        <strong>Scene {s.sceneNumber} — {s.title}</strong> <Badge tone="neutral">{s.status}</Badge>
                        <p className="text-slate-600 dark:text-slate-400">{s.description}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
          )}

          {tab === 'routing' && (
            <Card className="overflow-x-auto p-5">
              <h3 className="text-sm font-semibold">Multi-model routing plan</h3>
              <table className="mt-3 w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-400 dark:border-slate-700">
                    <th className="py-2 pr-3">Task</th>
                    <th className="py-2 pr-3">Preferred</th>
                    <th className="py-2 pr-3">Fallback</th>
                    <th className="py-2 pr-3 text-right">Est. cost</th>
                    <th className="py-2">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {contract.modelRoutingPlan.map((r, i) => (
                    <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="py-2 pr-3 font-medium">{r.task}</td>
                      <td className="py-2 pr-3">{r.preferredModel}</td>
                      <td className="py-2 pr-3 text-slate-500">{r.fallbackModel}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{r.estimatedCost}</td>
                      <td className="py-2 text-xs text-slate-500">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-3 text-xs text-slate-500">
                Budget limit: <strong>₹{contract.budgetLimit.toLocaleString('en-IN')}</strong> · final video is not
                generated until all approvals pass and storyboard is approved.
              </p>
            </Card>
          )}

          {tab === 'approvals' && (
            <Card className="divide-y divide-slate-200 dark:divide-slate-800">
              {contract.requiredApprovals.length === 0 && (
                <p className="p-5 text-sm text-slate-500">No approvers required for this contract.</p>
              )}
              {contract.requiredApprovals.map((a, i) => {
                const name = typeof a.userId === 'object' && a.userId ? a.userId.name || a.userId.email : String(a.userId);
                return (
                  <div key={i} className="flex flex-wrap items-center gap-3 p-4">
                    <Badge tone={a.status === 'approved' ? 'success' : a.status === 'rejected' ? 'danger' : 'warning'}>
                      {a.status}
                    </Badge>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{name}</p>
                      <p className="text-xs text-slate-500">{a.role.replace('_', ' ')}</p>
                    </div>
                    {a.decidedAt && <span className="text-xs text-slate-400">{new Date(a.decidedAt).toLocaleString()}</span>}
                    {a.comment && <p className="w-full rounded-lg bg-slate-50 p-2 text-xs dark:bg-slate-800/60">{a.comment}</p>}
                  </div>
                );
              })}
              {!allApproved && contract.status === 'pending_approval' && (
                <div className="flex justify-end gap-2 p-4">
                  <Button variant="danger" onClick={() => { setDecision('reject'); setComment(''); }}>
                    Reject with reason
                  </Button>
                  <Button onClick={() => { setDecision('approve'); setComment(''); }}>Approve contract</Button>
                </div>
              )}
              {(allApproved || contract.status === 'approved') && (
                <p className="flex items-center gap-2 p-4 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> All approvals collected — contract approved
                  {contract.approvedAt ? ` on ${new Date(contract.approvedAt).toLocaleString()}` : ''}
                </p>
              )}
            </Card>
          )}
        </div>

        {/* Sidebar: history */}
        <div className="space-y-5">
          <Card className="p-5">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <History className="h-4 w-4 text-slate-400" /> Version history
            </h3>
            <ol className="mt-3 space-y-3 border-l border-slate-200 pl-4 dark:border-slate-700">
              {data!.history.map((h) => (
                <li key={h._id} className="relative text-xs">
                  <span className={`absolute -left-[21px] top-1 h-2 w-2 rounded-full ${h.version === contract.version ? 'bg-brand-500' : 'bg-slate-400'}`} />
                  <p className="font-medium">v{h.version} — {h.status.replace('_', ' ')}</p>
                  <p className="text-slate-400">{new Date(h.createdAt).toLocaleString()}</p>
                </li>
              ))}
            </ol>
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold">Business rules enforced</h3>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600 dark:text-slate-400">
              <li>Only project owner, lead or authorised reviewers can approve</li>
              <li>Every material change creates a new version</li>
              <li>Critical conflicts / unlicensed assets / unsupported claims block generation</li>
              <li>Planned cost over remaining budget requires finance approval</li>
            </ul>
          </Card>
        </div>
      </div>

      {/* Decision modal */}
      <Modal
        open={decision !== null}
        onClose={() => setDecision(null)}
        title={decision === 'approve' ? 'Approve Production Contract' : 'Reject Production Contract'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
            <Button
              variant={decision === 'reject' ? 'danger' : 'primary'}
              loading={decide.isPending}
              disabled={decision === 'reject' && comment.trim().length < 3}
              onClick={() => decide.mutate()}
            >
              {decision === 'approve' ? 'Confirm approval' : 'Reject contract'}
            </Button>
          </>
        }

      >
        <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">
          {decision === 'approve'
            ? 'Your approval, comment, role and timestamp are recorded in the contract and the audit trail.'
            : 'A reason is required. The project returns to validation and the contract can be regenerated as a new version.'}
        </p>
        <Field label={decision === 'reject' ? 'Reason (required)' : 'Comment (optional)'}>
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={decision === 'reject' ? 'Claims unverified; audience definition too broad…' : 'Looks good — approved.'}
          />
        </Field>
      </Modal>
    </div>
  );
}

function Item({ label, value, wide }: { label: string; value?: string; wide?: boolean }) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</dt>
      <dd className={`mt-0.5 text-sm ${value ? '' : 'italic text-slate-400'}`}>{value || 'Not set'}</dd>
    </div>
  );
}

function ContractStat({ label, value, tone }: { label: string; value: string; tone: 'success' | 'warning' | 'danger' | 'brand' }) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-400">{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </Card>
  );
}
