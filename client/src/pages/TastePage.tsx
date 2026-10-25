import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Palette, Sparkles, History, RotateCcw, Wand2, Lightbulb, LayoutGrid, Users, GitBranch, Layers } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  Progress,
  SectionTitle,
  Select,
  Textarea,
  cx,
} from '../components/ui';
import { toast } from '../store/toast';

/* ---------------- types ---------------- */

type Adherence = 'low' | 'medium' | 'high';
type Exploration = 'new' | 'close' | 'mix';
type Dna = Record<string, Record<string, unknown>>;

interface TasteResponse {
  dna: Dna;
  baseDna: Dna;
  projectDna: Dna | null;
  projectId: string | null;
  adherence: Adherence;
  explorationMode: Exploration;
  stats: { acceptedOutputs: number; edits: number; rejections: number };
  confidence: {
    score: number;
    reason: string;
    basis: { acceptedOutputs: number; edits: number; rejections: number; populatedCategories: number };
  };
  onboardedAt: string | null;
  updatedAt: string;
}

interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'list' | 'select';
  options?: string[];
}

const CATEGORY_META: Array<{ id: string; label: string; blurb: string; fields: FieldSpec[] }> = [
  {
    id: 'visual',
    label: 'Visual DNA',
    blurb: 'Colours, lighting, texture, imagery, composition',
    fields: [
      { key: 'palette', label: 'Colour palette', kind: 'list' },
      { key: 'mood', label: 'Colour mood', kind: 'select', options: ['calm', 'premium', 'playful', 'luxurious', 'energetic', 'festive', 'earthy', 'bold'] },
      { key: 'contrast', label: 'Contrast', kind: 'select', options: ['soft', 'medium', 'high'] },
      { key: 'lighting', label: 'Lighting', kind: 'select', options: ['natural', 'cinematic', 'bright', 'moody', 'studio'] },
      { key: 'texture', label: 'Texture', kind: 'select', options: ['clean', 'grainy', 'paper-like', 'glossy', 'handmade'] },
      { key: 'style', label: 'Visual style', kind: 'list' },
      { key: 'imagery', label: 'Imagery focus', kind: 'list' },
      { key: 'composition', label: 'Composition', kind: 'select', options: ['centered', 'symmetrical', 'dynamic', 'rule-of-thirds'] },
      { key: 'aspectRatios', label: 'Aspect ratios', kind: 'list' },
    ],
  },
  {
    id: 'motion',
    label: 'Motion DNA',
    blurb: 'Animation style, camera, transitions, intensity',
    fields: [
      { key: 'animationStyle', label: 'Animation style', kind: 'list' },
      { key: 'energy', label: 'Motion energy', kind: 'select', options: ['calm', 'smooth', 'energetic', 'dramatic'] },
      { key: 'camera', label: 'Camera movement', kind: 'list' },
      { key: 'transitions', label: 'Transitions', kind: 'list' },
      { key: 'objects', label: 'Object animation', kind: 'list' },
      { key: 'intensity', label: 'Motion intensity', kind: 'select', options: ['low', 'medium', 'high'] },
    ],
  },
  {
    id: 'rhythm',
    label: 'Rhythm DNA',
    blurb: 'Pacing, scene duration, cut frequency, energy curve',
    fields: [
      { key: 'sceneDuration', label: 'Scene duration', kind: 'text' },
      { key: 'cutFrequency', label: 'Cut frequency', kind: 'select', options: ['slow', 'medium', 'fast'] },
      { key: 'hookSpeed', label: 'Hook speed', kind: 'select', options: ['slow', 'medium', 'fast'] },
      { key: 'energyCurve', label: 'Energy curve', kind: 'text' },
      { key: 'preferredLength', label: 'Preferred length', kind: 'text' },
      { key: 'platformPacing', label: 'Pacing per platform', kind: 'list' },
    ],
  },
  {
    id: 'sound',
    label: 'Sound DNA',
    blurb: 'Music genre, mood, tempo, voiceover, effects',
    fields: [
      { key: 'genres', label: 'Music genres', kind: 'list' },
      { key: 'mood', label: 'Music mood', kind: 'select', options: ['calm', 'inspiring', 'energetic', 'emotional', 'premium', 'playful'] },
      { key: 'tempo', label: 'Tempo', kind: 'select', options: ['slow', 'medium', 'fast'] },
      { key: 'voiceStyle', label: 'Voiceover style', kind: 'select', options: ['warm', 'confident', 'friendly', 'authoritative', 'energetic', 'conversational'] },
      { key: 'voiceAccent', label: 'Voice accent preference', kind: 'text' },
      { key: 'musicVolume', label: 'Music volume', kind: 'select', options: ['low', 'medium', 'high'] },
      { key: 'sfx', label: 'Sound effects', kind: 'select', options: ['subtle', 'present', 'none'] },
      { key: 'sync', label: 'Music sync', kind: 'select', options: ['beat-synced', 'mood-based', 'none'] },
    ],
  },
  {
    id: 'typography',
    label: 'Typography DNA',
    blurb: 'Font style, placement, captions, text animation',
    fields: [
      { key: 'fontStyle', label: 'Font style', kind: 'select', options: ['modern sans-serif', 'elegant serif', 'bold display', 'handwritten', 'mono/technical'] },
      { key: 'placement', label: 'Text placement', kind: 'text' },
      { key: 'textAnimation', label: 'Text animation', kind: 'list' },
      { key: 'captionStyle', label: 'Caption style', kind: 'select', options: ['minimal', 'bold', 'highlighted keywords', 'subtitle-style'] },
      { key: 'languageTone', label: 'Language tone', kind: 'select', options: ['simple', 'premium', 'friendly', 'technical', 'emotional'] },
    ],
  },
  {
    id: 'story',
    label: 'Story DNA',
    blurb: 'Story structure, emotional arc, humour, narrative',
    fields: [
      { key: 'structure', label: 'Story structure', kind: 'list' },
      { key: 'emotionalArc', label: 'Emotional arc', kind: 'list' },
      { key: 'narrativeStyle', label: 'Narrative style', kind: 'select', options: ['direct', 'cinematic', 'conversational', 'educational', 'premium/minimal'] },
      { key: 'humor', label: 'Humour level', kind: 'select', options: ['none', 'light', 'playful', 'strong'] },
      { key: 'exampleTypes', label: 'Example/story usage', kind: 'list' },
    ],
  },
  {
    id: 'audience',
    label: 'Audience DNA',
    blurb: 'Age group, platform, culture, attention span',
    fields: [
      { key: 'ageGroup', label: 'Age group', kind: 'text' },
      { key: 'mood', label: 'Audience mood', kind: 'text' },
      { key: 'culturalContext', label: 'Cultural context', kind: 'text' },
      { key: 'platform', label: 'Primary platform', kind: 'text' },
      { key: 'attentionSpan', label: 'Attention span', kind: 'select', options: ['short', 'medium', 'long'] },
      { key: 'format', label: 'Preferred format', kind: 'text' },
      { key: 'languageStyle', label: 'Language style', kind: 'text' },
    ],
  },
  {
    id: 'workflow',
    label: 'Workflow DNA',
    blurb: 'Question depth, editing mode, approval style',
    fields: [
      { key: 'questionDepth', label: 'AI questions', kind: 'select', options: ['few', 'balanced', 'many'] },
      { key: 'editingMode', label: 'Editing mode', kind: 'select', options: ['manual', 'assisted', 'auto'] },
      { key: 'approvalStyle', label: 'Approval style', kind: 'select', options: ['step', 'fast'] },
      { key: 'explanation', label: 'Explanations', kind: 'select', options: ['short', 'detailed'] },
      { key: 'suggestions', label: 'Show suggestions', kind: 'select', options: ['true', 'false'] },
      { key: 'riskiness', label: 'Idea range', kind: 'select', options: ['conservative', 'balanced', 'bold'] },
      { key: 'previewFirst', label: 'Visual preview first', kind: 'select', options: ['true', 'false'] },
      { key: 'notifications', label: 'Notifications', kind: 'select', options: ['immediate', 'digest'] },
    ],
  },
  {
    id: 'model',
    label: 'Model DNA',
    blurb: 'Preferred models, cost sensitivity, quality',
    fields: [
      { key: 'preferredModels', label: 'Preferred models', kind: 'list' },
      { key: 'costSensitivity', label: 'Cost sensitivity', kind: 'select', options: ['low', 'medium', 'high'] },
      { key: 'qualityPreference', label: 'Quality preference', kind: 'select', options: ['fast', 'balanced', 'best'] },
    ],
  },
  {
    id: 'brand',
    label: 'Brand DNA',
    blurb: 'Rules, colours, tone, terminology, restrictions',
    fields: [
      { key: 'colors', label: 'Brand colours', kind: 'list' },
      { key: 'tone', label: 'Brand tone', kind: 'text' },
      { key: 'terminology', label: 'Approved terms', kind: 'list' },
      { key: 'bannedWords', label: 'Banned words', kind: 'list' },
      { key: 'rules', label: 'Brand rules', kind: 'list' },
      { key: 'restrictions', label: 'Restrictions', kind: 'list' },
    ],
  },
];

function summarize(cat: Record<string, unknown> | undefined): string {
  const parts: string[] = [];
  for (const v of Object.values(cat ?? {})) {
    if (Array.isArray(v)) {
      if (v.length) parts.push(v.slice(0, 3).map(String).join(', '));
    } else if (typeof v === 'boolean') {
      parts.push(v ? 'yes' : 'no');
    } else if (v !== undefined && v !== null && v !== '') {
      parts.push(String(v));
    }
    if (parts.length >= 3) break;
  }
  return parts.join(' · ') || 'Not set yet';
}

function initValues(dna: Record<string, unknown> | undefined, fields: FieldSpec[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = (dna ?? {})[f.key];
    out[f.key] = Array.isArray(v) ? v.map(String).join(', ') : v === undefined || v === null ? '' : String(v);
  }
  return out;
}

/* ---------------- page ---------------- */

export default function TastePage() {
  const { projectId } = useParams();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const [resetOpen, setResetOpen] = useState(false);
  const activeWs = typeof localStorage !== 'undefined' ? localStorage.getItem('rf_ws') || '' : '';

  const tasteKey = ['taste', projectId ?? 'user'];
  const { data: taste, isLoading, error } = useQuery({
    queryKey: tasteKey,
    queryFn: () =>
      api.get<TasteResponse>(`/api/taste${projectId ? `?projectId=${projectId}` : ''}`),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: tasteKey });
    void queryClient.invalidateQueries({ queryKey: ['taste'] });
  };

  const saveDna = useMutation({
    mutationFn: (body: { dna: Record<string, unknown>; remember?: boolean; scope?: 'profile' | 'project' }) => {
      if (body.scope === 'project' && projectId) {
        return api.put<TasteResponse>(`/api/taste/project/${projectId}`, { dna: body.dna });
      }
      return api.put<TasteResponse>('/api/taste', { dna: body.dna, remember: body.remember ?? true });
    },
    onSuccess: () => {
      invalidate();
      toast.success('Taste updated');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setControls = useMutation({
    mutationFn: (body: { adherence?: Adherence; explorationMode?: Exploration }) => {
      if (projectId) return api.put<TasteResponse>(`/api/taste/project/${projectId}`, body);
      return api.put<TasteResponse>('/api/taste', body);
    },
    onSuccess: () => {
      invalidate();
      toast.success('Preference saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const meta = CATEGORY_META.find((c) => c.id === editing);

  if (isLoading) return <Loading label="Loading your Creative Taste DNA…" />;
  if (error) return <ErrorBox error={error} />;
  if (!taste) return null;

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      {/* -------- header -------- */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <Palette className="h-5 w-5 text-brand-600" aria-hidden /> Creative Taste DNA
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Your colours, motion, pacing, sound, typography and workflow preferences — used to make every
            generation start closer to your taste while Brand DNA, approved facts, rights and budget still win.
          </p>
        </div>
        <div className="flex gap-2">
          <ExportButton taste={taste} />
          <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
            <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset
          </Button>
        </div>
      </div>

      {/* -------- confidence + slider + exploration -------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <SectionTitle title="Taste confidence" subtitle={taste.confidence.reason} />
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{taste.confidence.score}%</span>
            <span className="text-xs text-slate-500">
              {taste.stats.acceptedOutputs} accepted · {taste.stats.edits} edits · {taste.stats.rejections} rejections
            </span>
          </div>
          <Progress value={taste.confidence.score} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => logOutcome('accepted')}>Log: accepted</Button>
            <Button size="sm" variant="outline" onClick={() => logOutcome('edited')}>Log: edited</Button>
            <Button size="sm" variant="outline" onClick={() => logOutcome('rejected')}>Log: rejected</Button>
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            Logging how an output did keeps the score honest — the same signal feeds Taste history.
          </p>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Follow my taste" subtitle="Taste Slider — how strongly generation follows your profile." />
          <div className="space-y-2" role="radiogroup" aria-label="Taste adherence">
            {([
              ['low', 'Low', 'More neutral and experimental'],
              ['medium', 'Medium', 'Balanced with contract defaults'],
              ['high', 'High', 'Strongly personalised output'],
            ] as const).map(([value, label, hint]) => (
              <label
                key={value}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
                  taste.adherence === value
                    ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                )}
              >
                <input
                  type="radio"
                  name="adherence"
                  value={value}
                  checked={taste.adherence === value}
                  onChange={() => setControls.mutate({ adherence: value })}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <SectionTitle title="Style exploration" subtitle="Break creative fatigue on purpose." />
          <div className="space-y-2" role="radiogroup" aria-label="Exploration mode">
            {([
              ['new', 'Create something new', 'Deliberately step outside your usual style'],
              ['close', 'Stay close to my taste', 'Consistent direction every time'],
              ['mix', 'Mix my taste with a new direction', 'Familiar base, one surprise'],
            ] as const).map(([value, label, hint]) => (
              <label
                key={value}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
                  taste.explorationMode === value
                    ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
                )}
              >
                <input
                  type="radio"
                  name="exploration"
                  value={value}
                  checked={taste.explorationMode === value}
                  onChange={() => setControls.mutate({ explorationMode: value })}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{label}</span>
                  <span className="block text-xs text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </Card>
      </div>

      {/* -------- onboarding (#29) -------- */}
      {!taste.onboardedAt && (
        <OnboardingCard onDone={invalidate} />
      )}

      {/* -------- DNA card grid -------- */}
      <section aria-labelledby="dna-heading">
        <SectionTitle
          title="Your Creative Taste DNA"
          subtitle="Ten groups that shape every generation. Click edit to change any of them."
          action={<Badge tone="brand">{projectId ? 'Project view' : 'Personal profile'}</Badge>}
        />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5" id="dna-heading">
          {CATEGORY_META.map((cat) => {
            const source = projectId && taste.projectDna?.[cat.id] ? taste.projectDna[cat.id] : taste.dna[cat.id];
            const overridden = Boolean(projectId && taste.projectDna?.[cat.id]);
            return (
              <Card key={cat.id} className="flex flex-col p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold">{cat.label}</span>
                  {overridden && <Badge tone="info">project</Badge>}
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">{cat.blurb}</p>
                <p className="mt-2 flex-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{summarize(source)}</p>
                <Button size="sm" variant="ghost" className="mt-3 self-start" onClick={() => setEditing(cat.id)}>
                  Edit
                </Button>
              </Card>
            );
          })}
        </div>
      </section>

      {/* -------- mood translator (#11) -------- */}
      <MoodTranslator onApplied={invalidate} />

      {/* -------- presets (#23–#25) -------- */}
      <PresetsSection projectId={projectId} onApplied={invalidate} />

      {/* -------- project tools (#14, #19, #27, #28) -------- */}
      {projectId && <ProjectTools projectId={projectId} />}

      {/* -------- mood board (#21) -------- */}
      <MoodBoardGenerator />

      {/* -------- creative-block breaker (#30) -------- */}
      <BreakerCard />

      {/* -------- team insights (#26) -------- */}
      {activeWs && <TeamInsights workspaceId={activeWs} />}

      {/* -------- history (#18) -------- */}
      <HistoryCard />

      {/* -------- editor modal (#16 remember choice) -------- */}
      {meta && (
        <EditorModal
          key={meta.id}
          meta={meta}
          dna={(projectId && taste.projectDna?.[meta.id] ? taste.projectDna[meta.id] : taste.dna[meta.id]) ?? {}}
          hasProject={Boolean(projectId)}
          saving={saveDna.isPending}
          onClose={() => setEditing(null)}
          onSave={(values, scope) => {
            if (scope === 'no') {
              // "No" — the edit stays in this session only; nothing is persisted.
              toast.info('Not remembered — applied for this session only');
              setEditing(null);
              return;
            }
            saveDna.mutate(
              { dna: { [meta.id]: values }, scope },
              { onSuccess: () => setEditing(null) }
            );
          }}
        />
      )}

      {/* -------- reset modal (#17) -------- */}
      <ResetModal
        open={resetOpen}
        onClose={() => setResetOpen(false)}
        projectId={projectId}
        onDone={() => {
          setResetOpen(false);
          invalidate();
        }}
      />
    </div>
  );

  function logOutcome(action: 'accepted' | 'edited' | 'rejected') {
    api
      .post<{ confidence: { score: number } }>('/api/taste/learn', { action })
      .then((r) => {
        invalidate();
        toast.success(`Logged. Taste confidence is now ${r.confidence.score}%.`);
      })
      .catch((e: Error) => toast.error(e.message));
  }
}

/* ---------------- editor modal ---------------- */

function EditorModal(props: {
  meta: { id: string; label: string; blurb: string; fields: FieldSpec[] };
  dna: Record<string, unknown>;
  hasProject: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: (values: Record<string, unknown>, scope: 'profile' | 'project' | 'no') => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => initValues(props.dna, props.meta.fields));
  const [scope, setScope] = useState<'profile' | 'project' | 'no'>('profile');

  const build = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const f of props.meta.fields) {
      const raw = (values[f.key] ?? '').trim();
      out[f.key] = f.kind === 'list' ? raw.split(',').map((s) => s.trim()).filter(Boolean) : raw;
    }
    return out;
  };

  return (
    <Modal
      open
      onClose={props.onClose}
      title={`Edit ${props.meta.label}`}
      wide
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Remember this as my preference?
            <Select
              value={scope}
              onChange={(e) => setScope(e.target.value as 'profile' | 'project')}
              className="w-44 py-1.5 text-xs"
              aria-label="Remember this choice?"
            >
              <option value="profile">Yes — my profile</option>
              {props.hasProject && <option value="project">Only for this project</option>}
              <option value="no">No — session only</option>
            </Select>
          </label>
          <div className="flex gap-2">
            <Button variant="outline" onClick={props.onClose}>Cancel</Button>
            <Button loading={props.saving} onClick={() => props.onSave(build(), scope)}>
              {scope === 'no' ? 'Apply (not remembered)' : 'Save'}
            </Button>
          </div>
        </div>
      }
    >
      <p className="mb-4 text-sm text-slate-500">{props.meta.blurb}</p>
      <div className="grid gap-x-4 sm:grid-cols-2">
        {props.meta.fields.map((f) => (
          <Field
            key={f.key}
            label={f.label}
            hint={f.kind === 'list' ? 'comma separated' : undefined}
          >
            {f.kind === 'select' ? (
              <Select
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              >
                <option value="">—</option>
                {f.options?.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </Select>
            ) : (
              <Input
                value={values[f.key] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                placeholder={f.kind === 'list' ? 'e.g. cream, charcoal, amber' : ''}
              />
            )}
          </Field>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">
        “Only for this project” stores an override on this project; your personal profile stays untouched.
      </p>
    </Modal>
  );
}

/* ---------------- onboarding (#29) ---------------- */

function OnboardingCard({ onDone }: { onDone: () => void }) {
  const [mood, setMood] = useState('');
  const run = useMutation({
    mutationFn: async () => {
      const translated = await api.post<{ direction: { summary: string } }>('/api/taste/mood', { mood, apply: true });
      await api.put('/api/taste', { onboarded: true, source: 'onboarding' });
      return translated;
    },
    onSuccess: (r) => {
      onDone();
      toast.success(r.direction.summary);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="border-brand-200 bg-brand-50/40 p-5 dark:border-brand-500/30 dark:bg-brand-500/5">
      <SectionTitle
        title="Set up your Creative Taste in one line"
        subtitle="Describe how you like content to feel. ReadyForge turns it into your starting Taste DNA — you can refine every category below."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder='e.g. "premium and calm, warm cream tones, slow zooms"'
          aria-label="Describe your style"
        />
        <Button
          loading={run.isPending}
          disabled={mood.trim().length < 2}
          onClick={() => run.mutate()}
        >
          <Sparkles className="h-4 w-4" aria-hidden /> Build my taste
        </Button>
      </div>
    </Card>
  );
}

/* ---------------- mood translator (#11) ---------------- */

interface MoodDirection {
  mood: string;
  color: string;
  motion: string;
  music: string;
  typography: string;
  pacing: string;
  story: string;
  summary: string;
}

function MoodTranslator({ onApplied }: { onApplied: () => void }) {
  const [mood, setMood] = useState('');
  const [platform, setPlatform] = useState('');
  const [result, setResult] = useState<{ direction: MoodDirection; aiSource: string } | null>(null);

  const translate = useMutation({
    mutationFn: () =>
      api.post<{ direction: MoodDirection; aiSource: string }>(
        '/api/taste/mood',
        { mood, platform: platform || undefined, apply: false }
      ),
    onSuccess: (r) => setResult(r),
    onError: (e: Error) => toast.error(e.message),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.post<{ applied: boolean }>('/api/taste/mood', { mood, platform: platform || undefined, apply: true }),
    onSuccess: () => {
      onApplied();
      toast.success('Direction applied to your Taste DNA');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        title="Mood-to-Style Translator"
        subtitle="Type a mood — ReadyForge converts it into colour, motion, music, typography, pacing and story directions."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={mood}
          onChange={(e) => setMood(e.target.value)}
          placeholder='e.g. "festive and energetic"'
          aria-label="Mood phrase"
          className="flex-1"
        />
        <Input
          value={platform}
          onChange={(e) => setPlatform(e.target.value)}
          placeholder="Platform (optional)"
          aria-label="Platform"
          className="sm:w-48"
        />
        <Button loading={translate.isPending} disabled={mood.trim().length < 2} onClick={() => translate.mutate()}>
          <Wand2 className="h-4 w-4" aria-hidden /> Translate
        </Button>
      </div>

      {result && (
        <div className="mt-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge tone={result.aiSource === 'ai' ? 'brand' : 'neutral'}>
              {result.aiSource === 'ai' ? 'AI' : 'rule engine'}
            </Badge>
            <span className="text-xs text-slate-500">{result.direction.summary}</span>
          </div>
          <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(
              [
                ['Colour', result.direction.color],
                ['Motion', result.direction.motion],
                ['Music', result.direction.music],
                ['Typography', result.direction.typography],
                ['Pacing', result.direction.pacing],
                ['Story', result.direction.story],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</dt>
                <dd className="mt-0.5 text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <Button className="mt-3" loading={apply.isPending} onClick={() => apply.mutate()}>
            Apply to my Taste DNA
          </Button>
        </div>
      )}
    </Card>
  );
}

/* ---------------- presets (#23–#25) ---------------- */

interface Preset {
  id: string;
  type: 'seasonal' | 'platform' | 'projectType';
  label: string;
  description: string;
}

function PresetsSection({ projectId, onApplied }: { projectId?: string; onApplied: () => void }) {
  const [type, setType] = useState<'seasonal' | 'platform' | 'projectType'>('seasonal');
  const { data } = useQuery({
    queryKey: ['taste', 'presets'],
    queryFn: () => api.get<{ presets: Preset[] }>('/api/taste/presets'),
  });

  const apply = useMutation({
    mutationFn: (presetId: string) =>
      api.post<{ ok: boolean }>(
        '/api/taste/presets/apply',
        projectId ? { presetId, projectId } : { presetId }
      ),
    onSuccess: () => {
      onApplied();
      toast.success('Preset applied');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const groups: Array<{ id: Preset['type']; label: string }> = [
    { id: 'seasonal', label: 'Seasonal' },
    { id: 'platform', label: 'Platform' },
    { id: 'projectType', label: 'Project type' },
  ];
  const presets = (data?.presets ?? []).filter((p) => p.type === type);

  return (
    <Card className="p-5">
      <SectionTitle
        title="Taste presets"
        subtitle="Seasonal, platform and project-type starting points you can apply in one click."
        action={
          <div className="flex gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700" role="tablist" aria-label="Preset type">
            {groups.map((g) => (
              <button
                key={g.id}
                role="tab"
                aria-selected={type === g.id}
                onClick={() => setType(g.id)}
                className={cx(
                  'rounded-md px-3 py-1 text-xs font-medium transition',
                  type === g.id ? 'bg-brand-600 text-white' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                )}
              >
                {g.label}
              </button>
            ))}
          </div>
        }
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {presets.map((p) => (
          <div key={p.id} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-sm font-medium">{p.label}</p>
            <p className="mt-1 flex-1 text-xs text-slate-500">{p.description}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-3"
              loading={apply.isPending && apply.variables === p.id}
              onClick={() => apply.mutate(p.id)}
            >
              Apply
            </Button>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] text-slate-400">
        Applies to {projectId ? 'this project only' : 'your personal profile'}.
      </p>
    </Card>
  );
}

/* ---------------- project tools (#14, #19, #27, #28) ---------------- */

interface TasteConflictT {
  kind: string;
  severity: 'low' | 'medium' | 'high';
  message: string;
  tasteSays: string;
  projectSays: string;
  options: string[];
}

function ProjectTools({ projectId }: { projectId: string }) {
  const [briefs, setBriefs] = useState<Array<Record<string, string>> | null>(null);

  const { data: conflicts } = useQuery({
    queryKey: ['taste', 'conflicts', projectId],
    queryFn: () => api.get<{ conflicts: TasteConflictT[] }>(`/api/taste/conflicts/${projectId}`),
  });
  const { data: recs } = useQuery({
    queryKey: ['taste', 'recommendations', projectId],
    queryFn: () =>
      api.get<{
        recommendations: Array<{ id: string; name: string; score: number; matchedOn: string[]; licenseStatus: string }>;
        note: string;
      }>(`/api/taste/recommendations/${projectId}`),
  });
  const { data: routing } = useQuery({
    queryKey: ['taste', 'routing', projectId],
    queryFn: () =>
      api.get<{ preference: string; costSensitivity: string; advice: string[] }>(`/api/taste/routing/${projectId}`),
  });

  const variants = useMutation({
    mutationFn: () => api.post<{ variants: Array<Record<string, string>> }>(`/api/taste/variants/${projectId}`, {}),
    onSuccess: (r) => setBriefs(r.variants),
    onError: (e: Error) => toast.error(e.message),
  });

  const clearOverride = useMutation({
    mutationFn: () => api.del(`/api/taste/project/${projectId}`),
    onSuccess: () => {
      void window.location.reload();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section aria-labelledby="project-tools" className="space-y-4">
      <SectionTitle
        title="Project taste tools"
        subtitle="Taste vs this project's intent, taste-based variants, asset matches and model routing."
        action={
          <Button size="sm" variant="ghost" onClick={() => clearOverride.mutate()}>
            Clear project override
          </Button>
        }
      />
      <div id="project-tools" className="grid gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-amber-500" aria-hidden /> Taste conflict detector
          </h3>
          {!conflicts?.conflicts.length ? (
            <p className="text-sm text-slate-500">No conflicts between your taste and this project's intent. </p>
          ) : (
            <ul className="space-y-3">
              {conflicts.conflicts.map((c, i) => (
                <li key={i} className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
                  <div className="flex items-center gap-2">
                    <Badge tone={c.severity === 'high' ? 'danger' : c.severity === 'medium' ? 'warning' : 'neutral'}>
                      {c.severity}
                    </Badge>
                    <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{c.kind.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1.5 text-sm">{c.message}</p>
                  <p className="mt-1 text-xs text-slate-500">Taste: {c.tasteSays}</p>
                  <p className="text-xs text-slate-500">Project: {c.projectSays}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.options.map((o) => (
                      <Badge key={o} tone="info">{o}</Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Layers className="h-4 w-4 text-brand-500" aria-hidden /> Taste-based variants
            </h3>
            <Button size="sm" loading={variants.isPending} onClick={() => variants.mutate()}>
              Generate briefs
            </Button>
          </div>
          {!briefs ? (
            <p className="text-sm text-slate-500">
              Three direction briefs — your taste, the opposite pole, and a mix — ready to hand to the campaign lab.
            </p>
          ) : (
            <ul className="space-y-3">
              {briefs.map((b, i) => (
                <li key={i} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{b.name}</span>
                    <Badge tone={b.adherence === 'high' ? 'brand' : 'neutral'}>adherence {b.adherence}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{b.direction}</p>
                  <p className="mt-1 text-xs text-slate-500">Hook: {b.hookStyle} · Pacing: {b.pacing}</p>
                  <p className="text-xs text-slate-500">Music: {b.music} · Story: {b.storyShape}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <LayoutGrid className="h-4 w-4 text-sky-500" aria-hidden /> Taste-matched assets
          </h3>
          {!recs?.recommendations.length ? (
            <p className="text-sm text-slate-500">{recs?.note ?? 'No assets in this project yet.'}</p>
          ) : (
            <>
              <ul className="space-y-2">
                {recs.recommendations.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 dark:border-slate-700">
                    <span className="truncate text-sm">{a.name}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={a.licenseStatus === 'owned' || a.licenseStatus === 'licensed' ? 'success' : 'warning'}>
                        {a.licenseStatus}
                      </Badge>
                      <span className="text-xs font-semibold tabular-nums text-slate-500">{a.score}%</span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] text-slate-400">{recs.note}</p>
            </>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-violet-500" aria-hidden /> Model routing (Model DNA)
          </h3>
          <p className="text-xs text-slate-500">
            Preference: <strong>{routing?.preference ?? '—'}</strong> · Cost sensitivity: <strong>{routing?.costSensitivity ?? '—'}</strong>
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-slate-600 dark:text-slate-300">
            {(routing?.advice ?? []).map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </Card>
      </div>
    </section>
  );
}

/* ---------------- mood board (#21) ---------------- */

interface MoodBoard {
  palette: string[];
  typography: string;
  motion: string;
  music: string;
  visualReferences: string[];
  storyboardFrames: Array<{ title: string; description: string }>;
  summary: string;
}

function MoodBoardGenerator() {
  const [brief, setBrief] = useState('');
  const [board, setBoard] = useState<MoodBoard | null>(null);

  const generate = useMutation({
    mutationFn: () => api.post<{ board: MoodBoard; aiSource: string }>('/api/taste/moodboard', { brief }),
    onSuccess: (r) => setBoard(r.board),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        title="Mood Board Generator"
        subtitle="From a short brief — palette, typography, motion, music, references and sample storyboard frames."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="Describe the piece: e.g. launch video for a handmade skincare brand, 20 seconds, warm and honest…"
          aria-label="Mood board brief"
          className="min-h-[72px] flex-1"
        />
        <Button loading={generate.isPending} disabled={brief.trim().length < 3} onClick={() => generate.mutate()} className="self-start sm:self-stretch">
          <Wand2 className="h-4 w-4" aria-hidden /> Generate board
        </Button>
      </div>

      {board && (
        <div className="mt-4 space-y-4">
          <p className="text-sm text-slate-500">{board.summary}</p>
          <div className="flex flex-wrap gap-2" aria-label="Palette">
            {board.palette.map((c) => (
              <span key={c} className="rounded-md border border-slate-200 px-3 py-1.5 text-xs dark:border-slate-700">
                {c}
              </span>
            ))}
          </div>
          <dl className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Typography</dt>
              <dd className="mt-0.5 text-sm">{board.typography}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Motion</dt>
              <dd className="mt-0.5 text-sm">{board.motion}</dd>
            </div>
            <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Music</dt>
              <dd className="mt-0.5 text-sm">{board.music}</dd>
            </div>
          </dl>
          <div>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">Storyboard frames</h4>
            <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {board.storyboardFrames.map((f) => (
                <li key={f.title} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  <p className="text-sm font-medium">{f.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{f.description}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------------- creative-block breaker (#30) ---------------- */

function BreakerCard() {
  const [stuckOn, setStuckOn] = useState('');
  const [suggestions, setSuggestions] = useState<Array<{ title: string; why: string; direction: string }> | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api.post<{ suggestions: Array<{ title: string; why: string; direction: string }> }>('/api/taste/breaker', { stuckOn }),
    onSuccess: (r) => setSuggestions(r.suggestions),
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        title="Creative-block breaker"
        subtitle="Stuck? Get new directions that blend your taste with deliberate novelty."
      />
      <div className="flex flex-col gap-3 sm:flex-row">
        <Input
          value={stuckOn}
          onChange={(e) => setStuckOn(e.target.value)}
          placeholder='e.g. "the opening hook of my product reel"'
          aria-label="What are you stuck on"
          className="flex-1"
        />
        <Button loading={run.isPending} disabled={stuckOn.trim().length < 2} onClick={() => run.mutate()}>
          <Lightbulb className="h-4 w-4" aria-hidden /> Suggest directions
        </Button>
      </div>
      {suggestions && (
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {suggestions.map((s) => (
            <li key={s.title} className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
              <p className="text-sm font-medium">{s.title}</p>
              <p className="mt-0.5 text-xs text-slate-400">{s.why}</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">{s.direction}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ---------------- team insights (#26) ---------------- */

function TeamInsights({ workspaceId }: { workspaceId: string }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['taste', 'insights', workspaceId],
    queryFn: () =>
      api.get<{
        members: number;
        commonPalettes: Array<{ value: string; count: number }>;
        commonMotionEnergy: Array<{ value: string; count: number }>;
        commonMusicGenres: Array<{ value: string; count: number }>;
        adherenceSplit: Array<{ value: string; count: number }>;
        divergences: string[];
        averageConfidence: number;
      }>(`/api/taste/insights/${workspaceId}`),
    retry: false,
  });

  if (isLoading) return <Loading label="Loading team taste…" />;
  if (error || !data || data.members === 0) {
    return (
      <Card className="p-5">
        <SectionTitle title="Team taste insights" subtitle="How your workspace's creative DNA lines up." />
        <EmptyState
          icon={<Users className="h-8 w-8" aria-hidden />}
          title="Not enough taste data yet"
          description="Team insights appear once workspace members complete their own Creative Taste onboarding."
        />
      </Card>
    );
  }

  const top = (rows: Array<{ value: string; count: number }>) =>
    rows.slice(0, 4).map((r) => `${r.value} (${r.count})`).join(', ') || '—';

  return (
    <Card className="p-5">
      <SectionTitle
        title="Team taste insights"
        subtitle={`${data.members} members · average confidence ${data.averageConfidence}%`}
      />
      <dl className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Common palettes</dt>
          <dd className="mt-0.5 text-sm">{top(data.commonPalettes)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Motion energy</dt>
          <dd className="mt-0.5 text-sm">{top(data.commonMotionEnergy)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Music genres</dt>
          <dd className="mt-0.5 text-sm">{top(data.commonMusicGenres)}</dd>
        </div>
        <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Adherence split</dt>
          <dd className="mt-0.5 text-sm">{top(data.adherenceSplit)}</dd>
        </div>
      </dl>
      {data.divergences.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-500/30 dark:bg-amber-500/5">
          <p className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300">Divergences</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-slate-700 dark:text-slate-200">
            {data.divergences.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/* ---------------- history (#18) + reset (#17) ---------------- */

function HistoryCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['taste', 'history'],
    queryFn: () =>
      api.get<{
        history: Array<{ id: string; at: string; category: string | null; summary: string; source: string; scope: string }>;
      }>('/api/taste/history'),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        title="Taste history"
        subtitle="What ReadyForge learned and when — every recommendation can be traced back here."
        action={<Badge tone="neutral">{data?.history.length ?? 0} entries</Badge>}
      />
      {isLoading ? (
        <Loading />
      ) : !data?.history.length ? (
        <EmptyState
          icon={<History className="h-8 w-8" aria-hidden />}
          title="No taste history yet"
          description="Edits, presets, mood translations and review decisions will appear here."
        />
      ) : (
        <ol className="space-y-2">
          {data.history.slice(0, 20).map((h) => (
            <li key={h.id} className="flex items-start gap-3 border-b border-slate-100 pb-2 text-sm last:border-0 dark:border-slate-800/60">
              <span className="shrink-0 text-xs tabular-nums text-slate-400">
                {new Date(h.at).toLocaleDateString()}
              </span>
              <span className="flex-1">{h.summary}</span>
              <span className="flex shrink-0 gap-1.5">
                {h.category && <Badge tone="brand">{h.category}</Badge>}
                <Badge tone={h.source === 'learned' ? 'info' : 'neutral'}>{h.source}</Badge>
                {h.scope === 'project' && <Badge tone="warning">project</Badge>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function ResetModal({
  open,
  onClose,
  projectId,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  projectId?: string;
  onDone: () => void;
}) {
  const reset = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/taste/reset', { scope: 'user' }),
    onSuccess: () => {
      toast.success('Taste Profile reset to defaults');
      onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Reset Creative Taste DNA?"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={reset.isPending} onClick={() => reset.mutate()}>
            Reset profile
          </Button>
        </>
      }
    >
      <p className="text-sm text-slate-600 dark:text-slate-300">
        This clears your personal Taste Profile — all ten categories, the taste slider, exploration mode and
        learning stats. History keeps the record so you can see what changed.{' '}
        {projectId && 'Project overrides on other projects are not affected.'}
      </p>
    </Modal>
  );
}

/* ---------------- export (#1 card: export) ---------------- */

function ExportButton({ taste }: { taste: TasteResponse }) {
  const download = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      adherence: taste.adherence,
      explorationMode: taste.explorationMode,
      confidence: taste.confidence,
      dna: taste.dna,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'readyforge-taste-dna.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Button variant="outline" size="sm" onClick={download} title="Export your Taste DNA as JSON">
      Export JSON
    </Button>
  );
}