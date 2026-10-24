import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { toast } from '../store/toast';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  SectionTitle,
  Textarea,
} from '../components/ui';

interface WorkspaceDetail {
  id: string;
  name: string;
  description: string;
  role: string | null;
  settings: { defaultCurrency: string; aiProviders: string[]; budgetApprovalThreshold: number };
}

interface AuditRow {
  id: string;
  action: string;
  entityType: string;
  actor: string;
  createdAt: string;
}

/**
 * Workspace Settings — name, currency, budget-approval threshold, plus the
 * audit trail (spec §6 / §12: audit logging for sensitive actions).
 * Only the workspace owner can save; others see a read-only view.
 */
export default function SettingsPage() {
  const { workspaceId = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['workspace', workspaceId],
    queryFn: () => api.get<WorkspaceDetail>(`/api/workspaces/${workspaceId}`),
    enabled: Boolean(workspaceId),
  });

  const { data: audit } = useQuery({
    queryKey: ['audit', workspaceId],
    queryFn: () => api.get<AuditRow[]>(`/api/workspaces/${workspaceId}/audit-logs`),
    enabled: Boolean(workspaceId),
  });

  const [form, setForm] = useState({ name: '', description: '', currency: 'INR', threshold: '1000' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        name: data.name,
        description: data.description || '',
        currency: data.settings?.defaultCurrency || 'INR',
        threshold: String(data.settings?.budgetApprovalThreshold ?? 1000),
      });
      setDirty(false);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/api/workspaces/${workspaceId}`, {
        name: form.name,
        description: form.description,
        settings: {
          defaultCurrency: form.currency,
          budgetApprovalThreshold: Number(form.threshold) || 0,
        },
      }),
    onSuccess: () => {
      toast.success('Workspace settings saved');
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId] });
      queryClient.invalidateQueries({ queryKey: ['audit', workspaceId] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (isLoading) return <Loading label="Loading settings…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const isOwner = data.role === 'owner';

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Workspace settings"
        subtitle={`${data.name} · your role: ${data.role || 'viewer'}`}
        action={
          isOwner ? (
            <Button variant="primary" size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              <Save className="mr-1 h-3.5 w-3.5" />
              {save.isPending ? 'Saving…' : 'Save changes'}
            </Button>
          ) : (
            <Badge tone="neutral">
              <ShieldCheck className="mr-1 inline h-3 w-3" /> Owner-only settings
            </Badge>
          )
        }
      />

      <Card className="grid gap-4 md:grid-cols-2">
        <Field label="Workspace name">
          <Input
            value={form.name}
            disabled={!isOwner}
            onChange={(e) => {
              setForm((f) => ({ ...f, name: e.target.value }));
              setDirty(true);
            }}
          />
        </Field>
        <Field label="Default currency" hint="Used by budgets, cost-at-risk and AI usage">
          <Input
            value={form.currency}
            disabled={!isOwner}
            maxLength={6}
            onChange={(e) => {
              setForm((f) => ({ ...f, currency: e.target.value.toUpperCase() }));
              setDirty(true);
            }}
          />
        </Field>
        <div className="md:col-span-2">
          <Field label="Description">
            <Textarea
              rows={2}
              value={form.description}
              disabled={!isOwner}
              onChange={(e) => {
                setForm((f) => ({ ...f, description: e.target.value }));
                setDirty(true);
              }}
            />
          </Field>
        </div>
        <Field
          label="Budget approval threshold"
          hint="Generations above this amount require explicit approval"
        >
          <Input
            type="number"
            min={0}
            value={form.threshold}
            disabled={!isOwner}
            onChange={(e) => {
              setForm((f) => ({ ...f, threshold: e.target.value }));
              setDirty(true);
            }}
          />
        </Field>
        <div className="flex items-end gap-1.5 pb-1 text-xs text-slate-500">
          <Badge tone="neutral">AI providers</Badge>
          <span>{(data.settings?.aiProviders || []).join(', ') || 'none'}</span>
        </div>
      </Card>

      <div>
        <SectionTitle title="Audit trail" subtitle="Last 100 sensitive actions in this workspace." />
        <Card className="max-h-96 overflow-y-auto p-0">
          <table className="w-full min-w-[480px] text-left text-xs">
            <thead className="sticky top-0 border-b border-slate-200 bg-white text-slate-500 dark:border-slate-800 dark:bg-slate-950">
              <tr>
                <th className="px-4 py-2 font-medium">When</th>
                <th className="px-4 py-2 font-medium">Action</th>
                <th className="px-4 py-2 font-medium">Entity</th>
                <th className="px-4 py-2 font-medium">Actor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {(audit || []).map((row) => (
                <tr key={row.id}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">
                    {new Date(row.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2 font-medium">{row.action}</td>
                  <td className="px-4 py-2 text-slate-500">{row.entityType}</td>
                  <td className="px-4 py-2">{row.actor}</td>
                </tr>
              ))}
              {(audit || []).length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-slate-500">
                    No audit entries yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}