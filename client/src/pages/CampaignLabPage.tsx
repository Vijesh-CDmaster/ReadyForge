import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, Wand2, CheckCircle2, XCircle, Sparkles, Gauge, FlaskConical, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Loading,
  Progress,
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

/* ---------- Roadmap 31: Pre-Flight Performance Forecast ---------- */

interface ForecastDimension {
  key: string;
  label: string;
  score: number;
  evidence: string[];
}

interface Forecast {
  dimensions: ForecastDimension[];
  attention: number;
  messageClarity: number;
  hookStrength: number;
  audienceFit: number;
  fatigueRisk: 'low' | 'medium' | 'high';
  overall: number;
  recommendation: string;
  disclaimer: string;
}

function ForecastSection({ projectId }: { projectId: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['forecast', projectId],
    queryFn: () => api.get<{ forecast: Forecast }>(`/api/projects/${projectId}/preflight-forecast`),
  });

  if (isLoading) return <Loading label="Computing pre-flight forecast…" />;
  if (error) return <ErrorBox error={error} />;
  const f = data?.forecast;
  if (!f) return null;

  return (
    <div>
      <SectionTitle
        title="Pre-Flight Performance Forecast"
        subtitle="Transparent rule-based estimate of attention, clarity, hook, audience fit and fatigue — before you spend on final generation."
        action={<Badge tone={f.overall >= 70 ? 'success' : f.overall >= 50 ? 'warning' : 'danger'}>Overall {f.overall}/100</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <div className="space-y-4">
            {f.dimensions.map((d) => (
              <div key={d.key}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium">{d.label}</span>
                  <span className="text-slate-500">{d.score}/100</span>
                </div>
                <Progress value={d.score} />
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{d.evidence[0]}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Gauge className="h-4 w-4 text-brand-600" /> Forecast verdict
          </div>
          <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{f.recommendation}</p>
          <div className="mt-auto flex flex-wrap gap-2">
            <Badge tone="info">Attention {f.attention}</Badge>
            <Badge tone="info">Clarity {f.messageClarity}</Badge>
            <Badge tone="info">Hook {f.hookStrength}</Badge>
            <Badge tone="info">Audience fit {f.audienceFit}</Badge>
            <Badge tone={f.fatigueRisk === 'low' ? 'success' : f.fatigueRisk === 'medium' ? 'warning' : 'danger'}>
              Fatigue {f.fatigueRisk}
            </Badge>
          </div>
          <p className="text-[11px] italic text-slate-400">{f.disclaimer}</p>
        </Card>
      </div>
    </div>
  );
}

/* ---------- Roadmap 32: Campaign Experiment Planner ---------- */

interface ExperimentPlan {
  hypothesis: string;
  arms: Array<{ name: string; changes: string; keepConstant: string }>;
  heldConstant: string[];
  successMetric: string;
  guardrails: string[];
  estimatedCost: number;
  recommendation: string;
}

function ExperimentSection({ projectId }: { projectId: string }) {
  const planQuery = useQuery({
    queryKey: ['experiment-plan', projectId],
    queryFn: () =>
      api.get<{ plan: ExperimentPlan; aiSource: string; model: string; disclaimer: string }>(
        `/api/projects/${projectId}/experiment-plan`
      ),
    enabled: false,
  });
  const refetch = () => void planQuery.refetch();
  const data = planQuery.data;
  const plan = data?.plan;

  return (
    <div>
      <SectionTitle
        title="Campaign Experiment Planner"
        subtitle="One controlled A/B experiment — one variable changed, everything else held constant."
        action={
          <Button loading={planQuery.isFetching && planQuery.fetchStatus !== 'idle'} onClick={refetch}>
            <FlaskConical className="h-4 w-4" /> Plan experiment
          </Button>
        }
      />

      {planQuery.isError && <ErrorBox error={planQuery.error} className="mb-3" />}

      {!plan && !planQuery.isFetching && (
        <EmptyState
          icon={<FlaskConical className="h-8 w-8" />}
          title="No experiment planned yet"
          description="Generate a cost-controlled A/B plan: two arms, one changed variable, and a success metric — using only approved facts."
          action={<Button onClick={refetch}>Plan experiment</Button>}
        />
      )}

      {planQuery.isFetching && !plan && <Loading label="Planning experiment…" />}

      {plan && !planQuery.isFetching && (
        <div className="space-y-4">
          <Card className="border-brand-200 bg-brand-50/50 p-5 dark:border-brand-900 dark:bg-brand-500/5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 dark:text-brand-300">Hypothesis</p>
            <p className="mt-1 text-sm font-medium">{plan.hypothesis}</p>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            {plan.arms.map((arm, i) => (
              <Card key={`${arm.name}-${i}`} className="p-5">
                <div className="flex items-center gap-2">
                  <Badge tone={i === 0 ? 'brand' : 'info'}>Arm {i === 0 ? 'A' : 'B'}</Badge>
                  <h3 className="text-sm font-semibold">{arm.name}</h3>
                </div>
                <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{arm.changes}</p>
                <p className="mt-2 text-xs text-slate-500">Kept constant: {arm.keepConstant}</p>
              </Card>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Held constant</p>
              <ul className="mt-2 space-y-1 text-sm text-slate-600 dark:text-slate-300">
                {plan.heldConstant.map((h, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" /> {h}
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-5">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Success metric & guardrails</p>
              <p className="mt-2 flex items-center gap-2 text-sm font-medium">
                <ArrowRight className="h-3.5 w-3.5 text-brand-600" /> {plan.successMetric}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-slate-500">
                {plan.guardrails.map((g, i) => (
                  <li key={i}>• {g}</li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 px-4 py-3 text-xs dark:border-slate-800">
            <span className="text-slate-500">{plan.recommendation}</span>
            <span className="font-medium">Est. experiment cost: ₹{plan.estimatedCost}</span>
          </div>

          <div className="flex items-center gap-2">
            <AiSourceBadge source={data!.aiSource} model={data!.model} />
            <p className="text-[11px] italic text-slate-400">{data!.disclaimer}</p>
          </div>
        </div>
      )}
    </div>
  );
}

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
    <div className="space-y-8">
      {/* ---------- Pre-Flight Performance Forecast ---------- */}
      <ForecastSection projectId={project.id} />

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

      {/* ---------- Experiment Planner ---------- */}
      <ExperimentSection projectId={project.id} />
    </div>
  );
}