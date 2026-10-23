import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from '../components/ui';
import { toast } from '../store/toast';

const schema = z.object({
  name: z.string().min(2, 'Workspace name must be at least 2 characters').max(120),
  description: z.string().max(1000).optional(),
  currency: z.string().length(3),
});
type FormValues = z.infer<typeof schema>;

export default function CreateWorkspace() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const refreshMe = useAuthStore((s) => s.refreshMe);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { currency: 'INR' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { workspace } = await api.post<{ workspace: { id: string } }>('/api/workspaces', {
        name: values.name,
        description: values.description,
        currency: values.currency,
      });
      await refreshMe();
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Workspace created');
      navigate(`/app/workspaces/${workspace.id}`);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Failed to create workspace');
    }
  });

  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-xl font-semibold">Create workspace</h1>
      <p className="mt-1 text-sm text-slate-500">
        Workspaces hold your team, brand rules, assets and projects. Each member gets a role.
      </p>

      <Card className="mt-5 p-6">
        <form onSubmit={onSubmit} noValidate>
          {serverError && <ErrorBox error={new Error(serverError)} className="mb-4" />}
          <Field label="Workspace name" error={formState.errors.name?.message}>
            <Input placeholder="Inkloom Marketing Team" {...register('name')} />
          </Field>
          <Field label="Description" hint="optional" error={formState.errors.description?.message}>
            <Textarea placeholder="What this workspace produces…" {...register('description')} />
          </Field>
          <Field label="Default currency">
            <Select {...register('currency')}>
              <option value="INR">INR (₹)</option>
              <option value="USD">USD ($)</option>
              <option value="EUR">EUR (€)</option>
              <option value="GBP">GBP (£)</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={formState.isSubmitting}>
              Create workspace
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
