import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Wand2, CheckCircle2, XCircle, Sparkles } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  SectionTitle,
} from '../components/ui';
import { AiSourceBadge } from '../components/widgets';
import { toast } from '../store/toast';
import { useProject } from './ProjectLayout';

interface SimRow {
  audience: string;
  likelyReaction: string;
  risk: 'low' | 'medium' | 'high';
  recommendation: string;
}

interface SimPayload {
  rows: SimRow[];
  aiSource: string;
  model: string;
  disclaimer: string;
}

interface Variant {
  id: string;
  name: string;
  hook: string;
  tone: string;
  audience: string;
  cta: string;
  format: string;
  durationSeconds: number;
  script: string;
  status: 'draft' | 'approved' | 'rejected';
  modelName: string;
  reviewComment?: string;
}

const RISK_TONE = { low: 'success', medium: 'warning', high: 'danger' } as const;

/**
 * Campaign Lab — pre-generation intelligence:
 *  1. Audience Simulation Panel (AI-simulated segment feedback)
 *  2. Creative Variant Matrix (two controlled variants inheriting the contract)
 */
export default function CampaignLabPage() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();

  const simulate = useMutation({
    mutationFn: () =>
      api.post<SimPayload>(`/api/projects/${project!.id}/audience-simulation`, {}),
    onError: (err) => toast.error(err.message),
  });

  const { data: variants, isLoading: variantsLoading } = useQuery({
    queryKey: ['variants', project?.id],
    queryFn: () => api.get<Variant[]>(`/api/projects/${project!.id}/variants`),
    enabled: Boolean(project?.id),
  });

  const generateVariants = useMutation({
    mutationFn: () =>
      api.post<{ variants: Variant[]; aiSource: string; model: string }>(
        `/api/projects/${project!.id}/variants`
      ),
    onSuccess: (res) => {
      toast.success(`Generated ${res.variants.length} variant(s) inheriting the approved contract`);
      void queryClient.invalidateQueries({ queryKey: ['variants', project?.id] });
      void queryClient.invalidateQueries({ queryKey: ['project', project?.id] });
      void queryClient.invalidateQueries({ queryKey: ['analytics'] });
    },
    onError: (err) => toast.error(err.message),
  });

  const reviewVariant = useMutation({
    mutationFn: (vars: { id: string; status: 'approved' | 'rejected' }) =>
      api.post(`/api/variants/${vars.id}/review`, { status: vars.status }),
    onSuccess: (_r, vars) => {
      toast.success(vars.status === 'approved' ? 'Variant approved' : 'Variant rejected');
      void queryClient.invalidateQueries({ queryKey: ['variants', project?.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;

  const sim = simulate.data;
  const list = variants || [];

  return (
    <div className="space-y-6">
      {/* ---------- Audience Simulation ---------- */}
      <div>
        <SectionTitle
          title="Audience Simulation Panel"
          subtitle="Simulated segment reactions before you spend on generation."
          action={
            <Button
              loading={simulate.isPending}
              onClick={() => simulate.mutate()}
            >
              <Users className="h-4 w-4" /> Simulate audience
            </Button>
          }
        />

        {simulate.isPending && <Loading label="Simulating audience reactions…" />}
        {simulate.error && <ErrorBox error={simulate.error} />}

        {!simulate.isPending && !sim && (
          <EmptyState
            icon={<Users className="h-8 w-8" />}
            title="No simulation yet"
            description="Run the simulation to compare how each audience segment would react to the planned tone, offer and CTA."
          />
        )}

        {sim && !simulate.isPending && (
          <>
            <Card className="overflow-x-auto p-0">
              <table className="w-full min-w-[640px] text-left text-xs">
                <thead className="border-b border-slate-200 text-slate-500 dark:border-slate-800">
                  <tr>
                    <th className="px-4 py-2 font-medium">Audience</th>
                    <th className="px-4 py-2 font-medium">Likely reaction</th>
                    <th className="px-4 py-2 font-medium">Risk</th>
                    <th className="px-4 py-2 font-medium">Recommendation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {sim.rows.map((r, i) => (
                    <tr key={`${r.audience}-${i}`}>
                      <td className="px-4 py-2 font-medium">{r.audience}</td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{r.likelyReaction}</td>
                      <td className="px-4 py-2">
                        <Badge tone={RISK_TONE[r.risk] || 'neutral'}>{r.risk}</Badge>
                      </td>
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-300">{r.recommendation}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <div className="mt-2 flex items-center gap-2">
              <AiSourceBadge source={sim.aiSource} model={sim.model} />
              <p className="text-xs italic text-slate-500">{sim.disclaimer}</p>
            </div>
          </>
        )}
      </div>

      {/* ---------- Creative Variant Matrix ---------- */}
      <div>
        <SectionTitle
          title="Creative Variant Matrix"
          subtitle="Two controlled variants — both inherit the same approved facts, brand rules and CTA."
          action={
            <Button
              loading={generateVariants.isPending}
              disabled={list.length >= 2}
              onClick={() => generateVariants.mutate()}
            >
              <Wand2 className="h-4 w-4" /> Generate 2 variants
            </Button>
          }
        />

        {generateVariants.error && <ErrorBox error={generateVariants.error} className="mb-3" />}

        {variantsLoading ? (
          <Loading label="Loading variants…" />
        ) : list.length === 0 ? (
          <EmptyState
            icon={<Wand2 className="h-8 w-8" />}
            title="No variants yet"
            description="Generate two variants (premium/emotional vs offer-led) from the approved contract. Requires an approved contract with cleared assets."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {list.map((v) => (
              <Card key={v.id} className="flex flex-col p-5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{v.name}</h3>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {v.format}
                      {v.durationSeconds ? ` · ${v.durationSeconds}s` : ''} · {v.tone}
                    </p>
                  </div>
                  <Badge
                    tone={v.status === 'approved' ? 'success' : v.status === 'rejected' ? 'danger' : 'warning'}
                  >
                    {v.status}
                  </Badge>
                </div>

                <p className="mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 dark:bg-brand-500/10 dark:text-brand-200">
                  “{v.hook}”
                </p>

                <dl className="mt-3 grid gap-1 text-xs text-slate-600 dark:text-slate-400">
                  <div><dt className="inline font-medium text-slate-500">Audience: </dt><dd className="inline">{v.audience || '—'}</dd></div>
                  <div><dt className="inline font-medium text-slate-500">CTA: </dt><dd className="inline">{v.cta || '—'}</dd></div>
                </dl>

                <pre className="mt-3 max-h-52 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs dark:bg-slate-900">
                  {v.script}
                </pre>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AiSourceBadge source={v.modelName === 'readyforge-rules' ? 'rule_engine' : 'ai'} model={v.modelName} />
                    {v.reviewComment && <span className="text-[11px] text-slate-400">“{v.reviewComment}”</span>}
                  </div>
                  {v.status === 'draft' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        loading={reviewVariant.isPending}
                        onClick={() => reviewVariant.mutate({ id: v.id, status: 'rejected' })}
                      >
                        <XCircle className="h-3.5 w-3.5" /> Reject
                      </Button>
                      <Button
                        size="sm"
                        loading={reviewVariant.isPending}
                        onClick={() => reviewVariant.mutate({ id: v.id, status: 'approved' })}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                      </Button>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        <p className="mt-3 flex items-center gap-1.5 text-xs italic text-slate-500">
          <Sparkles className="h-3.5 w-3.5" />
          Variants inherit approved contract facts only — review before publishing. AI-generated content is disclosed in the Provenance Passport.
        </p>
      </div>
    </div>
  );
}