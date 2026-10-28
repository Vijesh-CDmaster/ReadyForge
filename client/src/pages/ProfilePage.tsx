import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { User, Bell, ShieldCheck, Download, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorBox,
  Field,
  Input,
  Loading,
  Modal,
  SectionTitle,
  Select,
  cx,
} from '../components/ui';
import { toast } from '../store/toast';
import { useAuthStore } from '../store/auth';

interface NotificationPrefs {
  approvalRequired: boolean;
  generationComplete: boolean;
  conflictAssigned: boolean;
  budgetWarning: boolean;
  mentions: boolean;
}

const PREF_LABELS: Array<{ key: keyof NotificationPrefs; label: string; hint: string }> = [
  { key: 'approvalRequired', label: 'Approval requests', hint: 'When a generated output needs your decision' },
  { key: 'generationComplete', label: 'Generation & review results', hint: 'Approvals, rejections, failed generations' },
  { key: 'conflictAssigned', label: 'Conflicts assigned to me', hint: 'When the conflict engine routes a decision to you' },
  { key: 'budgetWarning', label: 'Budget warnings', hint: 'Overruns and cost-at-risk alerts' },
  { key: 'mentions', label: 'Mentions', hint: 'When a teammate @mentions you in a comment' },
];

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();

  const [name, setName] = useState(user?.name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [language, setLanguage] = useState(user?.language ?? 'en');
  const [timezone, setTimezone] = useState(user?.timezone ?? 'UTC');
  const [verifyUrl, setVerifyUrl] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs>({
    approvalRequired: true,
    generationComplete: true,
    conflictAssigned: true,
    budgetWarning: true,
    mentions: true,
  });
  const [prefsLoaded, setPrefsLoaded] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .get<{ notificationPrefs?: NotificationPrefs }>('/api/auth/me')
      .then((d) => {
        if (!cancelled && d.notificationPrefs) {
          setPrefs((p) => ({ ...p, ...d.notificationPrefs }));
          setPrefsLoaded(true);
        }
      })
      .catch(() => setPrefsLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const saveProfile = useMutation({
    mutationFn: () => api.patch<{ user: { name: string; email: string } }>('/api/auth/me', { name, email }),
    onSuccess: (d) => {
      // Keep the session cache in sync so the header shows the new name.
      void queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast.success('Profile updated');
      if (d.user.email !== user?.email) {
        toast.info('Email changed — re-verification will be required once email delivery is configured.');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePrefs = useMutation({
    mutationFn: () => api.patch('/api/auth/me', { notificationPrefs: prefs }),
    onSuccess: () => toast.success('Notification preferences saved'),
    onError: (e: Error) => toast.error(e.message),
  });

  const saveRegional = useMutation({
    mutationFn: () => api.patch('/api/auth/me', { language, timezone }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast.success('Preferences saved');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const resendVerification = useMutation({
    mutationFn: () =>
      api.post<{
        alreadyVerified?: boolean;
        verification?: { delivered?: boolean; verifyUrl?: string; note?: string };
      }>('/api/auth/resend-verification'),
    onSuccess: (d) => {
      if (d.alreadyVerified) {
        toast.success('Email already verified');
        return;
      }
      if (d.verification?.verifyUrl) {
        setVerifyUrl(d.verification.verifyUrl);
        toast.info(d.verification.note || 'Verification link created');
      } else if (d.verification?.delivered) {
        toast.success('Verification email sent');
      } else {
        toast.info(d.verification?.note || 'No email provider configured');
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const exportData = useMutation({
    mutationFn: () => api.get<unknown>('/api/auth/export'),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'readyforge-my-data.json';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Data export downloaded');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!user) return <Loading />;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300">
          <User className="h-6 w-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{user.name}</h1>
          <div className="flex items-center gap-2">
            <p className="text-sm text-slate-500">{user.email}</p>
            <Badge tone={user.platformRole === 'admin' ? 'brand' : 'neutral'}>{user.platformRole}</Badge>
          </div>
        </div>
      </div>

      {/* -------- profile -------- */}
      <Card className="p-5">
        <SectionTitle title="Profile" subtitle="Your name and email address." />
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        </Field>
        <Field label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
        </Field>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={user.isVerified ? 'success' : 'warning'}>
            {user.isVerified ? 'email verified' : 'email not verified'}
          </Badge>
          {!user.isVerified && (
            <Button variant="outline" size="sm" loading={resendVerification.isPending} onClick={() => resendVerification.mutate()}>
              Send verification link
            </Button>
          )}
        </div>
        {verifyUrl && (
          <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs dark:border-slate-700 dark:bg-slate-900">
            <p className="mb-1 font-medium">Verification link (development fallback — not emailed)</p>
            <code className="block break-all text-brand-600">{verifyUrl}</code>
          </div>
        )}
        <Button loading={saveProfile.isPending} disabled={name.trim().length < 2 || email.trim().length < 5} onClick={() => saveProfile.mutate()}>
          Save profile
        </Button>
      </Card>

      {/* -------- regional preferences (spec §1.2 / §12) -------- */}
      <Card className="p-5">
        <SectionTitle
          title="Regional preferences"
          subtitle="Used for dates and currency display. UI copy is English-only today — translations are on the roadmap."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="en">English</option>
              <option value="hi">हिन्दी (Hindi)</option>
              <option value="es">Español</option>
              <option value="fr">Français</option>
              <option value="de">Deutsch</option>
              <option value="ja">日本語</option>
            </Select>
          </Field>
          <Field label="Timezone" hint="IANA name — e.g. Asia/Kolkata">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {[
                'UTC',
                'Asia/Kolkata',
                'Asia/Dubai',
                'Asia/Singapore',
                'Asia/Tokyo',
                'Europe/London',
                'Europe/Berlin',
                'America/New_York',
                'America/Los_Angeles',
                'Australia/Sydney',
              ].map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Button loading={saveRegional.isPending} onClick={() => saveRegional.mutate()}>
          Save preferences
        </Button>
      </Card>

      {/* -------- notifications -------- */}
      <Card className="p-5">
        <SectionTitle
          title="Notification preferences"
          subtitle="ReadyForge respects these on the server — muted events are never created, not just hidden."
        />
        {prefsLoaded ? (
          <ul className="space-y-2">
            {PREF_LABELS.map((p) => (
              <li key={p.key}>
                <label
                  className={cx(
                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition',
                    prefs[p.key]
                      ? 'border-brand-500 bg-brand-50/60 dark:bg-brand-500/10'
                      : 'border-slate-200 dark:border-slate-700'
                  )}
                >
                  <input
                    type="checkbox"
                    checked={prefs[p.key]}
                    onChange={(e) => setPrefs((v) => ({ ...v, [p.key]: e.target.checked }))}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <Bell className="h-3.5 w-3.5 text-slate-400" aria-hidden /> {p.label}
                    </span>
                    <span className="text-xs text-slate-500">{p.hint}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Loading label="Loading preferences…" />
        )}
        <Button className="mt-4" loading={savePrefs.isPending} onClick={() => savePrefs.mutate()}>
          Save preferences
        </Button>
      </Card>

      {/* -------- security -------- */}
      <ChangePasswordCard />

      {/* -------- data -------- */}
      <Card className="p-5">
        <SectionTitle
          title="Your data"
          subtitle="Export everything attributed to your account, or delete it."
        />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={exportData.isPending} onClick={() => exportData.mutate()}>
            <Download className="h-4 w-4" aria-hidden /> Export my data (JSON)
          </Button>
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            <Trash2 className="h-4 w-4" aria-hidden /> Delete account
          </Button>
        </div>
      </Card>

      <DeleteAccountModal open={deleteOpen} onClose={() => setDeleteOpen(false)} />
    </div>
  );
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && next !== confirm;

  const change = useMutation({
    mutationFn: () => api.post<{ ok: boolean }>('/api/auth/change-password', { currentPassword: current, newPassword: next }),
    onSuccess: () => {
      toast.success('Password changed');
      setCurrent('');
      setNext('');
      setConfirm('');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <SectionTitle
        title="Change password"
        subtitle="Your current password is required. Changing it does not sign out other devices."
        action={
          <span className="flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" aria-hidden /> bcrypt-hashed, 10 rounds
          </span>
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Current password">
          <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New password" error={next && next.length < 8 ? 'Min 8 characters' : undefined}>
          <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" error={mismatch ? 'Passwords do not match' : undefined}>
          <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
      </div>
      <Button
        loading={change.isPending}
        disabled={!current || next.length < 8 || mismatch}
        onClick={() => change.mutate()}
      >
        Change password
      </Button>
    </Card>
  );
}

function DeleteAccountModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const logout = useAuthStore((s) => s.logout);

  // api.del cannot carry a request body, so deletion uses a direct fetch with { password }.
  const deleteAccount = useMutation({
    mutationFn: async () => {
      const token = localStorage.getItem('rf_token');
      const res = await fetch('/api/auth/me', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(data.error || `Deletion failed (${res.status})`);
      return true;
    },
    onSuccess: async () => {
      toast.success('Account deleted');
      onClose();
      await logout();
      window.location.href = '/';
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Delete your account?"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            loading={deleteAccount.isPending}
            disabled={password.length < 1 || confirmText !== 'DELETE'}
            onClick={() => deleteAccount.mutate()}
          >
            Permanently delete
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-slate-600 dark:text-slate-300">
          This removes your account, your memberships, and everything attributed to you as author.
          Workspaces you <strong>own</strong> must be deleted or transferred first — this protects your team's data.
          Audit-log entries recording your past actions are retained for workspace governance.
        </p>
        <ErrorBox
          error={new Error('This action is irreversible.')}
          className="!border-amber-300 !bg-amber-50 !text-amber-800 dark:!border-amber-500/40 dark:!bg-amber-500/10 dark:!text-amber-300"
        />
        <Field label="Type DELETE to confirm">
          <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="DELETE" />
        </Field>
        <Field label="Confirm with your password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </Field>
      </div>
    </Modal>
  );
}
