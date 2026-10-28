import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Field, Input, SectionTitle } from '../components/ui';
import { toast } from '../store/toast';

/** Public page reached from a reset link: /reset-password?token=… */
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const tokenFromUrl = params.get('token') ?? '';

  const [token, setToken] = useState(tokenFromUrl);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && password !== confirm;

  const reset = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/auth/reset-password', { token, newPassword: password }),
    onSuccess: () => {
      toast.success('Password updated — sign in with your new password');
      navigate('/login', { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <Link to="/" className="mb-6 flex items-center justify-center gap-2 text-lg font-semibold">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          ReadyForge
        </Link>

        <Card className="p-6">
          <SectionTitle
            title="Reset your password"
            subtitle="Paste the reset link's token (or the whole link) and choose a new password."
            action={<KeyRound className="h-5 w-5 text-slate-400" aria-hidden />}
          />

          {!tokenFromUrl && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
              No token in this link — paste the token you received below. Until an email provider is
              configured, ReadyForge shows the reset link on the “Forgot password?” request instead of emailing it.
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              reset.mutate();
            }}
          >
            {!tokenFromUrl && (
              <Field label="Reset token">
                <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="token from the reset link" />
              </Field>
            )}
            <Field label="New password" error={password && password.length < 8 ? 'Min 8 characters' : undefined}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field label="Confirm password" error={mismatch ? 'Passwords do not match' : undefined}>
              <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
            </Field>

            <Button type="submit" loading={reset.isPending} disabled={!token || password.length < 8 || mismatch} className="w-full">
              Set new password
            </Button>
          </form>

          {reset.isError && <ErrorBox error={reset.error} className="mt-4" />}

          <p className="mt-4 text-center text-sm text-slate-500">
            Remembered it?{' '}
            <Link to="/login" className="font-medium text-brand-600 hover:underline">
              Back to sign in
            </Link>
          </p>
        </Card>
      </div>
    </div>
  );
}
