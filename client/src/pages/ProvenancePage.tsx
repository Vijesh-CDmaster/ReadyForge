import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BadgeCheck,
  Bot,
  Clock,
  Download,
  FileCheck2,
  Flag,
  History,
  ListChecks,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { api, getStoredToken } from '../lib/api';
import { toast } from '../store/toast';
import { Badge, Button, Card, EmptyState, ErrorBox, Loading, SectionTitle } from '../components/ui';
import { AiSourceBadge } from '../components/widgets';

interface ProvenancePayload {
  project: { id: string; title: string; type: string; mode: string; status: string; createdAt: string; budget: { amount: number; currency: string; spent: number } };
  workspace: { id: string; name: string };
  contributors: Array<{ name: string; role: string }>;
  inputs: Array<{ id: string; type: string; title: string; content: string; status: string; sourceType: string; approvedAt: string | null; createdAt: string }>;
  conflicts: Array<{ id: string; title: string; conflictType: string; severity: string; status: string; resolution: string | null; resolvedAt: string | null }>;
  contracts: Array<{ version: number; status: string; approvedAt: string | null; approvals: Array<{ role: string; name: string; status: string; decidedAt: string | null; comment: string | null }> }>;
  tasks: Array<{ id: string; taskType: string; stage: string | null; attempt: number; modelProvider: string; modelName: string; cost: number; currency: string; latencyMs: number; status: string; reviewStatus: string; createdAt: string }>;
  reviews: Array<{ decision: string; reviewer: string; comment: string; rootCause?: string; resolution?: string; createdAt: string }>;
  assets: Array<{ id: string; name: string; type: string; licenseStatus: string; licenseType: string; licenseOwner: string; licenseExpiry: string | null; aiGenerated: boolean }>;
  latestVerification: { status: string; score: number; summary: string; createdAt: string } | null;
  totals: { generationCost: number; currency: string; tasks: number; approvedFacts: number; conflictsResolved: number; modelsUsed: string[] };
  aiDisclosure: string;
}

interface TimelineEvent {
  at: string;
  kind: 'human' | 'ai' | 'system';
  title: string;
  detail: string;
}

interface ClaimPassport {
  id: string;
  claim: string;
  title: string;
  status: string;
  source: string;
  suppliedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  usedIn: string[];
  model: string | null;
  verification: { status: string; evidence: string; suggestedFix?: string };
}

/**
 * Provenance Passport — the downloadable record of who supplied what, what the AI
 * did (model + cost), what humans approved, and the final verification result.
 */
export default function ProvenancePage() {
  const { projectId = '' } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ['provenance', projectId],
    queryFn: () => api.get<ProvenancePayload>(`/api/projects/${projectId}/provenance`),
    enabled: Boolean(projectId),
  });

  const { data: passport } = useQuery({
    queryKey: ['claim-passport', projectId],
    queryFn: () => api.get<{ claims: ClaimPassport[]; note: string | null }>(`/api/projects/${projectId}/claim-passport`),
    enabled: Boolean(projectId),
  });

  const events = useMemo<TimelineEvent[]>(() => {
    if (!data) return [];
    const list: TimelineEvent[] = [];
    data.inputs.forEach((i) =>
      list.push({
        at: i.approvedAt || i.createdAt,
        kind: 'human',
        title: `Input approved · ${i.type}`,
        detail: `${i.title} — ${i.content.slice(0, 140)}`,
      })
    );
    data.conflicts
      .filter((c) => c.resolvedAt)
      .forEach((c) =>
        list.push({
          at: c.resolvedAt!,
          kind: 'human',
          title: `Conflict resolved · ${c.conflictType}`,
          detail: `${c.title} — ${c.resolution || 'decided'}`,
        })
      );
    data.tasks.forEach((t) =>
      list.push({
        at: t.createdAt,
        kind: 'ai',
        title: `AI generated ${t.stage || t.taskType} (attempt ${t.attempt})`,
        detail: `${t.modelName} via ${t.modelProvider} · ${t.cost} ${t.currency} · ${t.latencyMs}ms · ${t.reviewStatus}`,
      })
    );
    data.contracts
      .filter((c) => c.approvedAt)
      .forEach((c) =>
        list.push({
          at: c.approvedAt!,
          kind: 'human',
          title: `Contract v${c.version} approved`,
          detail: c.approvals.map((a) => `${a.name} (${a.role}): ${a.status}`).join(', ') || 'approved',
        })
      );
    data.reviews.forEach((r) =>
      list.push({
        at: r.createdAt,
        kind: 'human',
        title: `Review · ${r.decision} by ${r.reviewer}`,
        detail: [r.comment, r.rootCause && `root cause: ${r.rootCause}`, r.resolution && `resolution: ${r.resolution}`]
          .filter(Boolean)
          .join(' · '),
      })
    );
    if (data.latestVerification) {
      list.push({
        at: data.latestVerification.createdAt,
        kind: 'ai',
        title: `Verification · ${data.latestVerification.status} (${data.latestVerification.score}%)`,
        detail: data.latestVerification.summary,
      });
    }
    list.push({ at: data.project.createdAt, kind: 'system', title: 'Project created', detail: `${data.project.mode} mode · ${data.project.type}` });
    return list.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  }, [data]);

  const download = () => {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ ...data, timeline: events }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `provenance-${data.project.title.replace(/\s+/g, '-').toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Spec 15.7: server-rendered PDF export of the same passport payload.
  const downloadPdf = async () => {
    if (!data) return;
    try {
      const res = await fetch(`/api/provenance/${projectId}/export/pdf`, {
        headers: { Authorization: `Bearer ${getStoredToken() || ''}` },
      });
      if (!res.ok) throw new Error(`PDF export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `provenance-${data.project.title.replace(/\s+/g, '-').toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Provenance passport exported as PDF');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF export failed');
    }
  };

  if (isLoading) return <Loading label="Building provenance passport…" />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;

  const passedFacts = data.inputs.filter((i) => i.type === 'fact' || i.type === 'claim');

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Provenance Passport"
        subtitle={`Complete record for “${data.project.title}” — human inputs, AI generations with model and cost, approvals and verification.`}
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={download}>
              <Download className="mr-1 h-4 w-4" /> Export JSON
            </Button>
            <Button variant="primary" size="sm" onClick={() => void downloadPdf()}>
              <Download className="mr-1 h-4 w-4" /> Export PDF
            </Button>
          </div>
        }
      />

      {/* summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: 'Generation cost', value: `${data.totals.generationCost} ${data.totals.currency}`, icon: Sparkles },
          { label: 'AI tasks', value: String(data.totals.tasks), icon: Bot },
          { label: 'Approved facts', value: String(data.totals.approvedFacts), icon: BadgeCheck },
          { label: 'Conflicts resolved', value: String(data.totals.conflictsResolved), icon: Flag },
        ].map((tile) => (
          <Card key={tile.label} className="flex items-center gap-3 p-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
              <tile.icon className="h-4 w-4" />
            </span>
            <div>
              <p className="text-lg font-semibold leading-tight tabular-nums">{tile.value}</p>
              <p className="text-xs text-slate-500">{tile.label}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* AI disclosure */}
      <Card className="border-brand-200 bg-brand-50/50 dark:border-brand-900 dark:bg-brand-950/40">
        <p className="flex items-start gap-2 text-sm text-brand-800 dark:text-brand-200">
          <Bot className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            <strong>AI disclosure:</strong> {data.aiDisclosure}
          </span>
        </p>
        {data.totals.modelsUsed.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1 pl-6">
            {data.totals.modelsUsed.map((m) => (
              <AiSourceBadge key={m} source="ai" model={m} />
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* timeline */}
        <div>
          <SectionTitle title="Timeline" subtitle="Newest first — every human and AI action." />
          <ol className="space-y-3">
            {events.map((ev, i) => (
              <li key={i} className="relative pl-7">
                <span
                  className={`absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border ${
                    ev.kind === 'ai'
                      ? 'border-brand-300 bg-brand-50 text-brand-600 dark:border-brand-800 dark:bg-brand-950'
                      : ev.kind === 'human'
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-950'
                        : 'border-slate-300 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-900'
                  }`}
                >
                  {ev.kind === 'ai' ? (
                    <Bot className="h-3 w-3" />
                  ) : ev.kind === 'human' ? (
                    <UserCheck className="h-3 w-3" />
                  ) : (
                    <Clock className="h-3 w-3" />
                  )}
                </span>
                <p className="text-sm font-medium">{ev.title}</p>
                <p className="text-xs text-slate-500">
                  {new Date(ev.at).toLocaleString()} · {ev.detail}
                </p>
              </li>
            ))}
          </ol>
        </div>

        {/* right column: facts, assets, approvals */}
        <div className="space-y-5">
          <div>
            <SectionTitle title="Approved facts used" />
            {passedFacts.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">No approved facts yet.</p>
              </Card>
            ) : (
              <Card className="space-y-2 p-3">
                {passedFacts.map((f) => (
                  <div key={f.id} className="rounded-md bg-slate-50 p-2 dark:bg-slate-900">
                    <p className="text-xs font-semibold">
                      {f.title} <Badge tone="neutral">{f.status}</Badge>
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-400">{f.content}</p>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle title="Claim Passport" subtitle="Every claim traced to its source, approver, usage and verification." />
            {!passport || passport.claims.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">{passport?.note || 'No claims recorded in the Knowledge Ledger yet.'}</p>
              </Card>
            ) : (
              <Card className="space-y-3 p-3">
                {passport.claims.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold">“{c.claim}”</p>
                      <Badge tone={c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'}>
                        {c.status}
                      </Badge>
                    </div>
                    <dl className="mt-2 grid gap-1 text-xs text-slate-600 dark:text-slate-400 sm:grid-cols-2">
                      <div><dt className="inline font-medium text-slate-500">Source: </dt><dd className="inline">{c.source}</dd></div>
                      <div><dt className="inline font-medium text-slate-500">Supplied by: </dt><dd className="inline">{c.suppliedBy}</dd></div>
                      <div><dt className="inline font-medium text-slate-500">Approved by: </dt><dd className="inline">{c.approvedBy || '—'}</dd></div>
                      <div><dt className="inline font-medium text-slate-500">Model: </dt><dd className="inline">{c.model || '—'}</dd></div>
                      <div className="sm:col-span-2"><dt className="inline font-medium text-slate-500">Used in: </dt><dd className="inline">{c.usedIn.length ? c.usedIn.join(' · ') : 'Not found in current script/storyboard'}</dd></div>
                    </dl>
                    <div className="mt-2 rounded-md bg-slate-50 p-2 text-xs dark:bg-slate-900">
                      <Badge tone={c.verification.status === 'passed' ? 'success' : c.verification.status === 'failed' ? 'danger' : 'warning'}>
                        {c.verification.status}
                      </Badge>{' '}
                      <span className="text-slate-600 dark:text-slate-400">{c.verification.evidence}</span>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle title="Asset licences" />
            {data.assets.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">No assets attached.</p>
              </Card>
            ) : (
              <Card className="space-y-2 p-3">
                {data.assets.map((a) => (
                  <div key={a.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate">
                      {a.name} {a.aiGenerated && <Badge tone="neutral">AI-generated</Badge>}
                    </span>
                    <Badge
                      tone={
                        a.licenseStatus === 'licensed' || a.licenseStatus === 'owned'
                          ? 'success'
                          : a.licenseStatus === 'unknown'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {a.licenseStatus}
                    </Badge>
                  </div>
                ))}
              </Card>
            )}
          </div>

          <div>
            <SectionTitle title="Approvals" />
            {data.contracts.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-500">No contract approvals yet.</p>
              </Card>
            ) : (
              <Card className="space-y-3 p-3">
                {data.contracts.map((c, ci) => (
                  <div key={`${c.version}-${ci}`}>
                    <p className="mb-1 flex items-center gap-2 text-xs font-semibold">
                      <FileCheck2 className="h-3.5 w-3.5" /> Contract v{c.version}{' '}
                      <Badge tone={c.status === 'approved' ? 'success' : 'neutral'}>{c.status}</Badge>
                      {c.approvedAt && (
                        <span className="font-normal text-slate-500">
                          {new Date(c.approvedAt).toLocaleString()}
                        </span>
                      )}
                    </p>
                    {c.approvals.length > 0 && (
                      <ul className="space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">
                        {c.approvals.map((a, i) => (
                          <li key={i} className="list-disc">
                            {a.name} · {a.role} · <strong>{a.status}</strong>
                            {a.comment && <> — “{a.comment}”</>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </div>

          {data.latestVerification && (
            <div>
              <SectionTitle title="Final verification" />
              <Card className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm">
                  <ListChecks className="h-4 w-4 text-slate-400" />
                  <span className="capitalize">{data.latestVerification.status}</span>
                  <span className="tabular-nums text-slate-500">{data.latestVerification.score}%</span>
                </div>
                <Badge tone={data.latestVerification.status === 'passed' ? 'success' : data.latestVerification.status === 'warning' ? 'warning' : 'danger'}>
                  {new Date(data.latestVerification.createdAt).toLocaleDateString()}
                </Badge>
              </Card>
            </div>
          )}
        </div>
      </div>

      {events.length === 0 && (
        <EmptyState icon={<History className="h-6 w-6" />} title="Nothing to show yet" description="Actions will appear as the project progresses." />
      )}
    </div>
  );
}