import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Field, Input, ErrorBox } from '../components/ui';
import { toast } from '../store/toast';

const schema = z
  .object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    email: z.string().email('Enter a valid email'),
    password: z.string().min(8, 'At least 8 characters'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match' });

type FormValues = z.infer<typeof schema>;

export default function Register() {
  const navigate = useNavigate();
  const location = useLocation();
  const applySession = useAuthStore((s) => s.applySession);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const data = await api.post<{ accessToken: string; user: { id: string; name: string; email: string; avatarUrl: string; platformRole: 'user' | 'admin' } }>(
        '/api/auth/register',
        { name: values.name, email: values.email, password: values.password }
      );
      await applySession(data.accessToken, data.user);
      toast.success('Account created — welcome to ReadyForge');
      // Preserve invite/reset context passed through location.state (spec §6.2).
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/register' ? from : '/app', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Registration failed');
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck className="h-5 w-5" />
          </span>
          ReadyForge
        </Link>

        <div className="card p-6">
          <h1 className="text-lg font-semibold">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">Then create a workspace and your first project.</p>

          <form className="mt-5" onSubmit={onSubmit} noValidate>
            {serverError && <ErrorBox error={new Error(serverError)} className="mb-4" />}

            <Field label="Name" error={formState.errors.name?.message}>
              <Input autoComplete="name" placeholder="Ada Lovelace" {...register('name')} />
            </Field>
            <Field label="Email" error={formState.errors.email?.message}>
              <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
            </Field>
            <Field label="Password" error={formState.errors.password?.message}>
              <Input type="password" autoComplete="new-password" placeholder="At least 8 characters" {...register('password')} />
            </Field>
            <Field label="Confirm password" error={formState.errors.confirm?.message}>
              <Input type="password" autoComplete="new-password" placeholder="Repeat password" {...register('confirm')} />
            </Field>

            <Button type="submit" loading={formState.isSubmitting} className="w-full">
              Create account
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            Already registered?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
