import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Field, Input } from '../components/ui';
import { useAuthStore } from '../store/auth';

/**
 * Consumes the single-use verification token from /verify-email?token=…
 * The token is sent to the API exactly once and never stored locally.
 */
export default function VerifyEmailPage() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';
  const user = useAuthStore((s) => s.user);
  const [manualToken, setManualToken] = useState('');
  const [done, setDone] = useState(false);

  const verify = useMutation({
    mutationFn: (value: string) => api.post<{ ok: boolean }>('/api/auth/verify-email', { token: value }),
    onSuccess: () => setDone(true),
  });

  const effective = token || manualToken.trim();

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10 dark:bg-slate-950">
      <div className="w-full max-w-md">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            ReadyForge
          </div>

          {done ? (
            <>
              <h1 className="text-xl font-bold">Email verified</h1>
              <p className="mt-2 text-sm text-slate-500">
                Your address is confirmed. You can carry on — the badge on your profile now shows
                “email verified”.
              </p>
              <Link to={user ? '/app/profile' : '/login'} className="mt-4 inline-block">
                <Button>Continue</Button>
              </Link>
            </>
          ) : (
            <>
              <h1 className="text-xl font-bold">Verify your email</h1>
              <p className="mt-2 text-sm text-slate-500">
                {token
                  ? 'Confirming the link you opened…'
                  : 'Paste the verification token from your link to confirm your address.'}
              </p>

              {verify.isError && <ErrorBox error={verify.error} className="mt-4" />}

              {!token && (
                <Field label="Verification token">
                  <Input
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="64-character token"
                    autoComplete="one-time-code"
                  />
                </Field>
              )}

              <Button
                className="mt-4 w-full"
                loading={verify.isPending}
                disabled={!effective}
                onClick={() => verify.mutate(effective)}
              >
                {token ? 'Verify my email' : 'Submit token'}
              </Button>

              <p className="mt-4 text-xs text-slate-500">
                Link expired? Sign in and request a new one from Profile → “Send verification link”.
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}