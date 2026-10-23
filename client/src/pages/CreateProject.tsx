import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Card, ErrorBox, Field, Input, Loading, Select, Textarea } from '../components/ui';
import { toast } from '../store/toast';

const schema = z.object({
  workspaceId: z.string().min(1, 'Select a workspace'),
  title: z.string().min(2, 'Title must be at least 2 characters').max(200),
  description: z.string().max(4000).optional(),
  mode: z.enum(['solo', 'team']),
  projectType: z.enum(['video', 'social_post', 'ad', 'blog', 'presentation', 'landing_page', 'custom']),
  objective: z.string().max(2000).optional(),
  budgetAmount: z.coerce.number().min(0).optional(),
});
type FormValues = z.infer<typeof schema>;

interface Classification {
  projectType: string;
  requiredInputs: string[];
  suggestedRoles: string[];
  risks: string[];
  recommendedWorkflow: string;
  aiSource: string;
}

export default function CreateProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { workspaces, refreshMe } = useAuthStore();
  const [serverError, setServerError] = useState<string | null>(null);
  const [classification, setClassification] = useState<Classification | null>(null);

  const { isLoading } = useQuery({ queryKey: ['workspaces'], queryFn: async () => workspaces });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { mode: 'solo', projectType: 'custom', workspaceId: workspaces[0]?.id || '' },
  });

  const classify = useMutation({
    mutationFn: (description: string) => api.post<Classification>('/api/ai/classify-project', { description }),
    onSuccess: (data) => {
      setClassification(data);
      if (data.projectType) form.setValue('projectType', data.projectType as FormValues['projectType']);
      toast.success(`Classified as ${data.projectType.replace('_', ' ')} (${data.aiSource === 'ai' ? 'AI' : 'rule engine'})`);
    },
    onError: (err) => toast.error(err.message),
  });

  const create = useMutation({
    mutationFn: (values: FormValues) =>
      api.post<{ project: { id: string } }>('/api/projects', {
        workspaceId: values.workspaceId,
        title: values.title,
        description: values.description,
        mode: values.mode,
        projectType: values.projectType,
        objective: values.objective || undefined,
        budget: values.budgetAmount ? { amount: values.budgetAmount, currency: 'INR' } : undefined,
      }),
    onSuccess: async ({ project }) => {
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project created — start with the AI input wizard');
      navigate(`/app/projects/${project.id}/inputs`);
    },
    onError: (err) => setServerError(err.message),
  });

  if (isLoading) return <Loading />;

  if (!workspaces.length) {
    return (
      <div className="mx-auto max-w-xl">
        <Card className="p-6 text-center">
          <p className="text-sm">You need a workspace before creating a project.</p>
          <Button className="mt-4" onClick={() => navigate('/app/workspaces/new')}>
            Create workspace
          </Button>
        </Card>
      </div>
    );
  }

  const onSubmit = form.handleSubmit((values) => create.mutate(values));

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold">Create project</h1>
      <p className="mt-1 text-sm text-slate-500">
        Describe it in one sentence — ReadyForge classifies it and generates adaptive questions next.
      </p>

      <Card className="mt-5 p-6">
        <form onSubmit={onSubmit} noValidate>
          {serverError && <ErrorBox error={new Error(serverError)} className="mb-4" />}

          <Field label="Workspace">
            <Select {...form.register('workspaceId')}>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="One-sentence description" error={form.formState.errors.title?.message}>
            <Input
              placeholder="Make a 20-second ad for my handmade candle shop."
              {...form.register('title')}
              onBlur={(e) => {
                if (e.target.value.trim().length > 8 && !classify.isPending) classify.mutate(e.target.value);
              }}
            />
          </Field>

          {classification && (
            <div className="mb-4 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs dark:border-brand-800 dark:bg-brand-500/10">
              <p className="font-semibold text-brand-800 dark:text-brand-200">
                Classified: {classification.projectType.replace('_', ' ')} ·{' '}
                {classification.aiSource === 'ai' ? 'AI-assisted' : 'rule engine'}
              </p>
              <p className="mt-1 text-brand-700 dark:text-brand-300">
                Required inputs: {classification.requiredInputs.join(', ') || '—'}
              </p>
              {classification.risks.length > 0 && (
                <p className="mt-1 text-amber-700 dark:text-amber-300">Risks: {classification.risks.join(' · ')}</p>
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Mode">
              <Select {...form.register('mode')}>
                <option value="solo">Solo mode</option>
                <option value="team">Team mode</option>
              </Select>
            </Field>
            <Field label="Project type" error={form.formState.errors.projectType?.message}>
              <Select {...form.register('projectType')}>
                <option value="video">Video</option>
                <option value="ad">Ad</option>
                <option value="social_post">Social post</option>
                <option value="blog">Blog</option>
                <option value="presentation">Presentation</option>
                <option value="landing_page">Landing page</option>
                <option value="custom">Custom</option>
              </Select>
            </Field>
          </div>

          <Field label="Objective" hint="optional for now — the wizard will ask" error={form.formState.errors.objective?.message}>
            <Textarea placeholder="Drive free-trial signups for the launch…" {...form.register('objective')} />
          </Field>

          <Field label="Budget (INR)" hint="powers Cost-at-Risk" error={form.formState.errors.budgetAmount?.message}>
            <Input type="number" min={0} placeholder="5000" {...form.register('budgetAmount')} />
          </Field>

          <div className="flex gap-2">
            <Button type="submit" loading={create.isPending}>
              Create project
            </Button>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
