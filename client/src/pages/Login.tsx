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

const schema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});
type FormValues = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const applySession = useAuthStore((s) => s.applySession);
  const [serverError, setServerError] = useState<string | null>(null);

  const { register, handleSubmit, formState } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    try {
      const data = await api.post<{ accessToken: string; user: { id: string; name: string; email: string; avatarUrl: string; platformRole: 'user' | 'admin' } }>(
        '/api/auth/login',
        values
      );
      await applySession(data.accessToken, data.user);
      toast.success(`Welcome back, ${data.user.name}`);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from !== '/login' ? from : '/app', { replace: true });
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Login failed');
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
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mt-1 text-sm text-slate-500">
            Demo: demo@readyforge.ai · demo1234
          </p>

          <form className="mt-5" onSubmit={onSubmit} noValidate>
            {serverError && <ErrorBox error={new Error(serverError)} className="mb-4" />}

            <Field label="Email" error={formState.errors.email?.message}>
              <Input type="email" autoComplete="email" placeholder="you@company.com" {...register('email')} />
            </Field>

            <Field label="Password" error={formState.errors.password?.message}>
              <Input type="password" autoComplete="current-password" placeholder="••••••••" {...register('password')} />
            </Field>

            <Button type="submit" loading={formState.isSubmitting} className="w-full">
              Sign in
            </Button>
          </form>

          <p className="mt-4 text-center text-sm text-slate-500">
            No account?{' '}
            <Link to="/register" className="font-medium text-brand-600 hover:underline">
              Create one
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
