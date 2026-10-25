import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Check, AlertTriangle, Trash2, ShieldCheck, Clock } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Select,
  Textarea,
  cx,
} from '../components/ui';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface LedgerInput {
  id: string;
  type: string;
  title: string;
  content: string;
  sourceType: string;
  status: 'draft' | 'approved' | 'disputed' | 'rejected' | 'expired';
  confidence: number;
  tags: string[];
  version: number;
  contributorName: string;
  contributorEmail: string;
  approvedAt?: string;
  createdAt: string;
}

const TYPE_OPTIONS = [
  'fact', 'claim', 'constraint', 'audience', 'tone', 'price',
  'asset_requirement', 'goal', 'visual_rule', 'legal_rule', 'other',
];

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  approved: 'success',
  draft: 'neutral',
  disputed: 'danger',
  rejected: 'danger',
  expired: 'warning',
};

interface DecayItem {
  id: string;
  title: string;
  type: string;
  reason: 'expired' | 'stale' | 'aging';
  daysOld: number;
  daysToExpiry: number | null;
  usedInCampaigns: number;
  action: string;
}

interface DecayPayload {
  expired: DecayItem[];
  aging: DecayItem[];
  items: DecayItem[];
  scanned: number;
  recommendation: string;
  disclaimer: string;
}

export default function KnowledgeLedger() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [draft, setDraft] = useState({ type: 'fact', title: '', content: '' });

  const { data, isLoading, error } = useQuery({
    queryKey: ['inputs', project?.id],
    queryFn: () => api.get<LedgerInput[]>(`/api/projects/${project!.id}/inputs`),
    enabled: Boolean(project?.id),
  });

  const { data: decay } = useQuery({
    queryKey: ['knowledge-decay', project?.workspaceId],
    queryFn: () => api.get<DecayPayload>(`/api/workspaces/${project!.workspaceId}/knowledge-decay`),
    enabled: Boolean(project?.workspaceId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['inputs', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['cost-at-risk', project?.id] });
  };

  const add = useMutation({
    mutationFn: () =>
      api.post(`/api/projects/${project!.id}/inputs`, {
        type: draft.type,
        title: draft.title,
        content: draft.content,
        sourceType: 'user_input',
        confidence: 0.7,
      }),
    onSuccess: () => {
      toast.success('Knowledge input added');
      setAddOpen(false);
      setDraft({ type: 'fact', title: '', content: '' });
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/api/inputs/${id}/approve`),
    onSuccess: () => {
      toast.success('Input approved');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const dispute = useMutation({
    mutationFn: (id: string) => api.post(`/api/inputs/${id}/dispute`, { reason: 'Disputed in ledger review' }),
    onSuccess: () => {
      toast.success('Input disputed — a conflict will be flagged on next detection');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/api/inputs/${id}`),
    onSuccess: () => {
      toast.success('Input deleted');
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading ledger…" />;
  if (error) return <ErrorBox error={error} />;

  const filtered = (data || []).filter(
    (i) => (statusFilter === 'all' || i.status === statusFilter) && (typeFilter === 'all' || i.type === typeFilter)
  );
  const approvedCount = (data || []).filter((i) => i.status === 'approved').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-base font-semibold">Knowledge Ledger</h2>
          <Badge tone="success">{approvedCount} approved</Badge>
          <Badge tone="neutral">{data?.length || 0} total</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select className="w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="approved">Approved</option>
            <option value="disputed">Disputed</option>
            <option value="rejected">Rejected</option>
          </Select>
          <Select className="w-40" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="all">All types</option>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </Select>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> Add input
          </Button>
        </div>
      </div>

      {/* Knowledge Decay Detector */}
      {decay && decay.items.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">
              Knowledge decay detected — {decay.items.length} of {decay.scanned} inputs need re-confirmation
            </p>
          </div>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">{decay.recommendation}</p>
          <ul className="mt-2 space-y-1.5">
            {decay.items.slice(0, 5).map((item) => (
              <li key={item.id} className="flex flex-wrap items-center gap-2 text-xs text-amber-900 dark:text-amber-100">
                <Badge tone={item.reason === 'expired' ? 'danger' : 'warning'}>{item.reason}</Badge>
                <span className="font-medium">{item.title}</span>
                <span className="text-amber-700 dark:text-amber-300">
                  {item.reason === 'expired' ? item.action : `${item.daysOld} days old · used in ${item.usedInCampaigns} contract(s)`}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] italic text-amber-700/80 dark:text-amber-300/80">{decay.disclaimer}</p>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-slate-500">
          No inputs match these filters. Add facts, claims, constraints and brand rules — or use the AI wizard.
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((input) => (
            <Card key={input.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="brand">{input.type.replace('_', ' ')}</Badge>
                <Badge tone={STATUS_TONE[input.status]}>{input.status}</Badge>
                {input.version > 1 && <Badge tone="neutral">v{input.version}</Badge>}
                <span className="ml-auto text-[11px] text-slate-400">
                  {input.sourceType.replace('_', ' ')}
                </span>
              </div>

              <h4 className="mt-2 text-sm font-semibold">{input.title}</h4>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{input.content}</p>

              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span>By {input.contributorName}</span>
                <span className="flex items-center gap-1">
                  confidence {Math.round(input.confidence * 100)}%
                </span>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {input.status !== 'approved' && (
                  <Button size="sm" variant="outline" onClick={() => approve.mutate(input.id)} disabled={approve.isPending}>
                    <Check className="h-3.5 w-3.5 text-emerald-600" /> Approve
                  </Button>
                )}
                {input.status === 'approved' && (
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <ShieldCheck className="h-3.5 w-3.5" /> Approved {input.approvedAt ? new Date(input.approvedAt).toLocaleDateString() : ''}
                  </span>
                )}
                {input.status === 'draft' && (
                  <Button size="sm" variant="ghost" onClick={() => dispute.mutate(input.id)} disabled={dispute.isPending}>
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Dispute
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (confirm('Delete this input?')) remove.mutate(input.id);
                  }}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add knowledge input"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
            <Button
              loading={add.isPending}
              disabled={!draft.title.trim() || !draft.content.trim()}
              onClick={() => add.mutate()}
            >
              Add to ledger
            </Button>
          </>
        }
      >
        <Field label="Type">
          <Select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
            {TYPE_OPTIONS.map((t) => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} placeholder="Starter plan price" />
        </Field>
        <Field label="Content" hint="facts only — no invention">
          <Textarea value={draft.content} onChange={(e) => setDraft((d) => ({ ...d, content: e.target.value }))} placeholder="Starter plan costs ₹499/month." />
        </Field>
        <p className="text-xs text-slate-500">
          Claims and facts need approval before they can back generated content.
        </p>
      </Modal>
    </div>
  );
}
