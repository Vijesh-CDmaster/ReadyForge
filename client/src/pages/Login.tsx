import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ShieldCheck } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAuthStore } from '../store/auth';
import { Button, Field, Input, ErrorBox, Modal } from '../components/ui';
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
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotResult, setForgotResult] = useState<{ resetUrl?: string; note?: string } | null>(null);

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

          <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
            <button
              type="button"
              className="font-medium text-brand-600 hover:underline"
              onClick={() => setForgotOpen(true)}
            >
              Forgot password?
            </button>
            <span>
              No account?{' '}
              <Link to="/register" className="font-medium text-brand-600 hover:underline">
                Create one
              </Link>
            </span>
          </div>
        </div>
      </div>

      <ForgotPasswordModal
        open={forgotOpen}
        email={forgotEmail}
        setEmail={setForgotEmail}
        result={forgotResult}
        setResult={setForgotResult}
        onClose={() => {
          setForgotOpen(false);
          setForgotResult(null);
        }}
      />
    </div>
  );
}

function ForgotPasswordModal(props: {
  open: boolean;
  email: string;
  setEmail: (v: string) => void;
  result: { resetUrl?: string; note?: string } | null;
  setResult: (r: { resetUrl?: string; note?: string } | null) => void;
  onClose: () => void;
}) {
  const request = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; resetUrl?: string; note?: string }>('/api/auth/forgot-password', {
        email: props.email,
      }),
    onSuccess: (d) => {
      // The API always answers 200 (no account enumeration); a resetUrl only
      // comes back while no email provider is configured.
      if (d.resetUrl) toast.info('No email provider is configured — the reset link is shown instead of being sent.');
      else toast.success('If that email exists, a reset link has been sent.');
      props.setResult(d.resetUrl || d.note ? { resetUrl: d.resetUrl, note: d.note } : null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal open={props.open} onClose={props.onClose} title="Reset your password">
      {!props.result ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
        >
          <p className="mb-4 text-sm text-slate-500">
            Enter your account email. If it exists, a reset link will be generated.
          </p>
          <Field label="Email">
            <Input
              type="email"
              value={props.email}
              onChange={(e) => props.setEmail(e.target.value)}
              placeholder="you@company.com"
              autoComplete="email"
            />
          </Field>
          <Button type="submit" loading={request.isPending} disabled={props.email.trim().length < 5} className="w-full">
            Send reset link
          </Button>
        </form>
      ) : (
        <ResetResult result={props.result} />
      )}
    </Modal>
  );
}

function ResetResult({ result }: { result: { resetUrl?: string; note?: string } }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">{result.note}</p>
      {result.resetUrl && (
        <>
          <code className="block break-all rounded-lg bg-slate-100 p-3 text-xs dark:bg-slate-800">{result.resetUrl}</code>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              void navigator.clipboard?.writeText(result.resetUrl!);
              toast.success('Reset link copied');
            }}
          >
            Copy reset link
          </Button>
        </>
      )}
    </div>
  );
}
