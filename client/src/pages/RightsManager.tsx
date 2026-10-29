import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, ShieldAlert, Scale, BellRing } from 'lucide-react';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Select, SectionTitle, cx } from '../components/ui';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface RightsAlert {
  id: string;
  name: string;
  type: string;
  licenseStatus: string;
  expiryDate: string | null;
  daysLeft: number | null;
  usedInCampaigns: number;
  level: 'danger' | 'warning' | 'info';
  message: string;
  action: string;
}

interface SentinelPayload {
  alerts: RightsAlert[];
  expiringSoon: number;
  scanned: number;
  recommendation: string;
  disclaimer: string;
}

interface AssetRow {
  id: string;
  name: string;
  type: string;
  fileUrl: string;
  licenseStatus: 'owned' | 'licensed' | 'unknown' | 'restricted' | 'expired';
  licenseType?: string;
  licenseOwner?: string;
  licenseExpiry?: string | null;
  allowedChannels: string[];
  allowedRegions: string[];
  consentRequired: boolean;
  consentStatus: string;
  aiGenerated: boolean;
}

interface RightsReport {
  status: 'passed' | 'warning' | 'failed';
  checks: Array<{ check: string; status: 'passed' | 'warning' | 'failed'; message: string }>;
  disclaimer: string;
}

const LICENSE_TONE: Record<string, 'success' | 'warning' | 'danger'> = {
  owned: 'success',
  licensed: 'success',
  unknown: 'warning',
  restricted: 'danger',
  expired: 'danger',
};

export default function RightsManager() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AssetRow | null>(null);
  const [form, setForm] = useState({
    licenseStatus: 'unknown',
    licenseType: '',
    licenseOwner: '',
    licenseExpiry: '',
    consentStatus: 'not_required',
  });
  const [reports, setReports] = useState<Record<string, RightsReport>>({});

  const { data, isLoading, error } = useQuery({
    queryKey: ['assets', project?.id],
    queryFn: () => api.get<AssetRow[]>(`/api/projects/${project!.id}/assets`),
    enabled: Boolean(project?.id),
  });

  const { data: sentinel } = useQuery({
    queryKey: ['rights-sentinel', project?.workspaceId],
    queryFn: () => api.get<SentinelPayload>(`/api/workspaces/${project!.workspaceId}/rights-sentinel`),
    enabled: Boolean(project?.workspaceId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['assets', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['readiness', project?.id] });
    void queryClient.invalidateQueries({ queryKey: ['cost-at-risk', project?.id] });
  };

  const saveLicense = useMutation({
    mutationFn: () =>
      api.post(`/api/assets/${editing!.id}/license`, {
        licenseStatus: form.licenseStatus,
        licenseType: form.licenseType || undefined,
        licenseOwner: form.licenseOwner || undefined,
        licenseExpiry: form.licenseExpiry ? new Date(form.licenseExpiry).toISOString() : null,
        consentStatus: form.consentStatus,
      }),
    onSuccess: () => {
      toast.success('Licence recorded and audit-logged');
      setEditing(null);
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const verify = useMutation({
    mutationFn: (id: string) => api.post<RightsReport>(`/api/assets/${id}/verify-rights`),
    onSuccess: (report, id) => {
      setReports((r) => ({ ...r, [id]: report }));
      if (report.status === 'failed') toast.error('Rights check failed — this asset blocks final generation');
      else if (report.status === 'warning') toast.info('Rights check produced warnings');
      else toast.success('Rights check passed');
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;
  if (isLoading) return <Loading label="Loading assets…" />;
  if (error) return <ErrorBox error={error} />;

  const assets = data || [];

  return (
    <div className="space-y-5">
      <SectionTitle
        title="Rights & licence manager"
        subtitle="Document permissions and verify every asset before it enters final production."
        action={<Badge tone={assets.length && assets.every((a) => a.licenseStatus === 'owned' || a.licenseStatus === 'licensed') ? 'success' : 'warning'}>{assets.length} assets tracked</Badge>}
      />
      <Card className="flex flex-wrap items-center gap-3 border-amber-200 bg-amber-50/60 p-4 dark:border-amber-900 dark:bg-amber-950/30">
        <Scale className="h-5 w-5 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800 dark:text-amber-200">
          <strong>This is a risk check, not legal advice.</strong> Assets with status{' '}
          <em>unknown</em>, <em>restricted</em> or <em>expired</em> are blocked from final generation.
        </p>
      </Card>

      {/* Rights Expiry Sentinel */}
      {sentinel && sentinel.alerts.length > 0 && (
        <Card className="border-rose-200 bg-rose-50/60 p-4 dark:border-rose-900 dark:bg-rose-950/30">
          <div className="flex items-center gap-2">
            <BellRing className="h-4 w-4 shrink-0 text-rose-600" />
            <p className="text-sm font-semibold text-rose-800 dark:text-rose-200">
              Rights Expiry Sentinel — {sentinel.alerts.length} alert(s) across {sentinel.scanned} assets
            </p>
          </div>
          <p className="mt-1 text-xs text-rose-700 dark:text-rose-300">{sentinel.recommendation}</p>
          <ul className="mt-2 space-y-1.5">
            {sentinel.alerts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 text-xs text-rose-900 dark:text-rose-100">
                <Badge tone={a.level === 'danger' ? 'danger' : 'warning'}>
                  {a.daysLeft !== null ? (a.daysLeft < 0 ? 'expired' : `${a.daysLeft}d left`) : a.licenseStatus}
                </Badge>
                <span className="font-medium">{a.name}</span>
                <span className="text-rose-700 dark:text-rose-300">{a.message} {a.action}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] italic text-rose-700/80 dark:text-rose-300/80">{sentinel.disclaimer}</p>
        </Card>
      )}

      {assets.length === 0 ? (
        <Card className="px-6 py-12 text-center text-sm text-slate-500">
          No assets yet — upload files in the Assets Library first.
        </Card>
      ) : (
        <div className="space-y-4">
          {assets.map((a) => {
            const report = reports[a.id];
            return (
              <Card key={a.id} className="p-5 transition hover:border-brand-300 dark:hover:border-brand-700">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className={cx('h-4 w-4', a.licenseStatus === 'owned' || a.licenseStatus === 'licensed' ? 'text-emerald-500' : 'text-rose-500')} />
                    <span className="text-sm font-semibold">{a.name}</span>
                    <Badge tone={LICENSE_TONE[a.licenseStatus]}>{a.licenseStatus}</Badge>
                    {a.consentRequired && (
                      <Badge tone={a.consentStatus === 'approved' ? 'success' : 'danger'}>consent: {a.consentStatus}</Badge>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      loading={verify.isPending && verify.variables === a.id}
                      onClick={() => verify.mutate(a.id)}
                    >
                      <ShieldAlert className="h-3.5 w-3.5" /> Verify rights
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(a);
                        setForm({
                          licenseStatus: a.licenseStatus,
                          licenseType: a.licenseType || '',
                          licenseOwner: a.licenseOwner || '',
                          licenseExpiry: a.licenseExpiry ? String(a.licenseExpiry).slice(0, 10) : '',
                          consentStatus: a.consentStatus,
                        });
                      }}
                    >
                      Edit licence
                    </Button>
                  </div>
                </div>

                <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-3">
                  <span>Type: {a.licenseType || '—'}</span>
                  <span>Owner: {a.licenseOwner || '—'}</span>
                  <span>Expiry: {a.licenseExpiry ? new Date(a.licenseExpiry).toLocaleDateString() : '—'}</span>
                </div>

                {report && (
                  <div
                    className={cx(
                      'mt-3 space-y-1.5 rounded-lg border p-3',
                      report.status === 'passed' && 'border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40',
                      report.status === 'warning' && 'border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40',
                      report.status === 'failed' && 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40'
                    )}
                  >
                    {report.checks.map((c, i) => (
                      <p key={i} className="text-xs">
                        <strong className="capitalize">{c.status}</strong> · {c.check.replace('_', ' ')} — {c.message}
                      </p>
                    ))}
                    <p className="pt-1 text-[10px] italic opacity-70">{report.disclaimer}</p>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Licence editor */}
      {editing && (
        <Card className="fixed inset-x-4 bottom-4 top-20 z-40 mx-auto max-w-lg overflow-y-auto p-5 shadow-2xl sm:inset-x-auto sm:right-8 sm:w-96">
          <h3 className="text-sm font-semibold">Licence — {editing.name}</h3>
          <div className="mt-4">
            <Field label="Licence status">
              <Select value={form.licenseStatus} onChange={(e) => setForm((f) => ({ ...f, licenseStatus: e.target.value }))}>
                <option value="owned">Owned</option>
                <option value="licensed">Licensed</option>
                <option value="unknown">Unknown</option>
                <option value="restricted">Restricted</option>
                <option value="expired">Expired</option>
              </Select>
            </Field>
            <Field label="Licence type">
              <Input value={form.licenseType} onChange={(e) => setForm((f) => ({ ...f, licenseType: e.target.value }))} placeholder="Royalty-free, CC-BY, proprietary…" />
            </Field>
            <Field label="Licence owner">
              <Input value={form.licenseOwner} onChange={(e) => setForm((f) => ({ ...f, licenseOwner: e.target.value }))} placeholder="Who owns / licensed it" />
            </Field>
            <Field label="Licence expiry" hint="optional">
              <Input type="date" value={form.licenseExpiry} onChange={(e) => setForm((f) => ({ ...f, licenseExpiry: e.target.value }))} />
            </Field>
            <Field label="Consent status">
              <Select value={form.consentStatus} onChange={(e) => setForm((f) => ({ ...f, consentStatus: e.target.value }))}>
                <option value="not_required">Not required</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button loading={saveLicense.isPending} onClick={() => saveLicense.mutate()}>
              Save licence
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
