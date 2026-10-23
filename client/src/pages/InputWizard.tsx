import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Sparkles, HelpCircle, ArrowRight, CheckCircle2, Users } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Input, Loading, Select, Textarea, Badge, cx } from '../components/ui';
import { AiSourceBadge } from '../components/widgets';
import { useProject } from './ProjectLayout';
import { toast } from '../store/toast';

interface Question {
  key: string;
  text: string;
  inputType: 'text' | 'textarea' | 'number' | 'choice' | 'date' | 'multiselect';
  inputKind: string;
  why: string;
  role: string;
  required: boolean;
}

interface QuestionSet {
  questions: Question[];
  aiSource: string;
  model: string;
}

const KIND_LABELS: Record<string, string> = {
  fact: 'Fact',
  claim: 'Claim',
  constraint: 'Constraint',
  audience: 'Audience',
  tone: 'Tone',
  price: 'Price',
  asset_requirement: 'Asset requirement',
  goal: 'Goal',
  visual_rule: 'Visual rule',
  legal_rule: 'Legal rule',
  other: 'Other',
};

export default function InputWizard() {
  const { data: project } = useProject();
  const queryClient = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [questionSet, setQuestionSet] = useState<QuestionSet | null>(null);

  const generate = useMutation({
    mutationFn: () => api.post<QuestionSet>('/api/ai/generate-questions', { projectId: project!.id, count: 4 }),
    onSuccess: (data) => {
      setQuestionSet(data);
      if (!data.questions.length) toast.info('No further questions — the ledger looks complete.');
    },
    onError: (err) => toast.error(err.message),
  });

  const save = useMutation({
    mutationFn: async () => {
      const toSave = (questionSet?.questions || []).filter((q) => (answers[q.key] || '').trim().length > 0);
      for (const q of toSave) {
        await api.post(`/api/projects/${project!.id}/inputs`, {
          type: q.inputKind,
          title: q.text.length > 90 ? `${q.key} — ${q.text.slice(0, 80)}…` : q.text,
          content: answers[q.key],
          sourceType: 'user_input',
          confidence: 0.7,
          tags: [q.key],
        });
      }
      return toSave.length;
    },
    onSuccess: (count) => {
      toast.success(`${count} answer${count === 1 ? '' : 's'} saved to the Knowledge Ledger`);
      setAnswers({});
      setQuestionSet(null);
      void queryClient.invalidateQueries({ queryKey: ['project', project!.id] });
      void queryClient.invalidateQueries({ queryKey: ['inputs', project!.id] });
      void queryClient.invalidateQueries({ queryKey: ['readiness', project!.id] });
    },
    onError: (err) => toast.error(err.message),
  });

  if (!project) return <Loading />;

  const answeredCount = Object.values(answers).filter((a) => a.trim()).length;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {/* Header */}
      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Sparkles className="h-4 w-4 text-brand-500" /> AI Input Collection Wizard
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              ReadyForge asks only relevant questions, a few at a time — based on project type, missing
              fields and detected risks. Each answer becomes a Knowledge Input.
            </p>
          </div>
          <Button onClick={() => generate.mutate()} loading={generate.isPending} disabled={save.isPending}>
            {questionSet ? 'Refresh questions' : 'Start / refresh questions'}
          </Button>
        </div>

        {questionSet && (
          <div className="mt-3 flex items-center gap-2">
            <AiSourceBadge source={questionSet.aiSource} model={questionSet.model} />
            <Badge tone="neutral">{questionSet.questions.length} questions</Badge>
          </div>
        )}
      </Card>

      {generate.isPending && <Loading label="Thinking about what's missing…" />}

      {generate.isError && <ErrorBox error={generate.error} />}

      {/* Empty state */}
      {!questionSet && !generate.isPending && (
        <Card className="flex flex-col items-center px-6 py-12 text-center">
          <HelpCircle className="mb-3 h-8 w-8 text-slate-400" />
          <h3 className="text-sm font-semibold">No questions generated yet</h3>
          <p className="mt-1 max-w-md text-sm text-slate-500">
            Click “Start / refresh questions” and the wizard will produce the next 3–5 highest-priority
            questions for this {project.projectType.replace('_', ' ')} project.
          </p>
        </Card>
      )}

      {/* Question cards */}
      {questionSet && questionSet.questions.length > 0 && (
        <div className="space-y-4">
          {questionSet.questions.map((q, idx) => {
            const filled = (answers[q.key] || '').trim().length > 0;
            return (
              <Card key={q.key} className={cx('p-5', filled && 'border-emerald-300 dark:border-emerald-800')}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 text-[10px] font-bold text-white">
                    {idx + 1}
                  </span>
                  <Badge tone="brand">{KIND_LABELS[q.inputKind] || q.inputKind}</Badge>
                  <Badge tone={q.required ? 'warning' : 'neutral'}>{q.required ? 'required' : 'optional'}</Badge>
                  <span className="ml-auto flex items-center gap-1 text-[11px] text-slate-400">
                    <Users className="h-3 w-3" /> for {q.role.replace(/_/g, ' ')}
                  </span>
                </div>

                <p className="text-sm font-medium">{q.text}</p>
                <p className="mt-1 flex items-start gap-1.5 text-xs text-slate-500">
                  <HelpCircle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span><strong>Why:</strong> {q.why}</span>
                </p>

                <div className="mt-3">
                  <QuestionInput
                    question={q}
                    value={answers[q.key] || ''}
                    onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                  />
                </div>

                {filled && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-emerald-600">
                    <CheckCircle2 className="h-3 w-3" /> Answer ready to save
                  </p>
                )}
              </Card>
            );
          })}

          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-500">{answeredCount} of {questionSet.questions.length} answered</p>
            <Button
              onClick={() => save.mutate()}
              loading={save.isPending}
              disabled={answeredCount === 0}
            >
              Save {answeredCount || ''} answer{answeredCount === 1 ? '' : 's'} to ledger <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function choiceOptions(question: Question): string[] {
  if (question.key === 'music_rights' || question.inputKind === 'legal_rule') {
    return ['Yes — licensed', 'No — not licensed', 'Unknown / not checked', 'No third-party media'];
  }
  if (question.inputKind === 'tone') {
    return ['Confident', 'Minimal', 'Playful', 'Professional', 'Urgent', 'Warm', 'Other'];
  }
  return ['Yes', 'No', 'Not sure yet', 'Other'];
}

function QuestionInput({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  if (question.inputType === 'choice') {
    return (
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Select…</option>
        {choiceOptions(question).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </Select>
    );
  }
  if (question.inputType === 'number') {
    return <Input type="number" min={0} placeholder="Amount" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (question.inputType === 'date') {
    return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  if (question.inputType === 'textarea') {
    return <Textarea placeholder="Your answer…" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <Input placeholder="Your answer…" value={value} onChange={(e) => onChange(e.target.value)} />;
}
