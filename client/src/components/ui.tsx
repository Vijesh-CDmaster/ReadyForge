import React from 'react';

export const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ---------------- Button ---------------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
export function Button(props: {
  children: React.ReactNode;
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  onClick?: () => void;
  className?: string;
  title?: string;
}) {
  const { children, variant = 'primary', size = 'md', loading, disabled, type = 'button', onClick, className, title } = props;
  const variants: Record<ButtonVariant, string> = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-slate-900 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    outline: 'border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800',
    danger: 'bg-rose-600 text-white hover:bg-rose-700',
  };
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-3.5 py-2 text-sm', lg: 'px-5 py-2.5 text-base' };
  return (
    <button
      type={type}
      title={title}
      onClick={onClick}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        className
      )}
    >
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={cx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
  );
}

/* ---------------- Form fields ---------------- */
export function Label(props: { children: React.ReactNode; htmlFor?: string; hint?: string }) {
  return (
    <label htmlFor={props.htmlFor} className="mb-1 flex items-baseline justify-between text-xs font-medium text-slate-600 dark:text-slate-300">
      <span>{props.children}</span>
      {props.hint && <span className="font-normal text-slate-400">{props.hint}</span>}
    </label>
  );
}

export function Field(props: { label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <Label hint={props.hint}>{props.label}</Label>
      {props.children}
      {props.error && <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">{props.error}</p>}
    </div>
  );
}

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref
) {
  return <input ref={ref} className={cx('input-base', className)} {...rest} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx('input-base min-h-[88px]', className)} {...rest} />
  }
);

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx('input-base', className)} {...rest}>
        {children}
      </select>
    );
  }
);

/* ---------------- Surfaces ---------------- */
export function Card(props: { children: React.ReactNode; className?: string }) {
  return <div className={cx('card', props.className)}>{props.children}</div>;
}

export function SectionTitle(props: { title: string; subtitle?: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">{props.title}</h2>
        {props.subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{props.subtitle}</p>}
      </div>
      {props.action}
    </div>
  );
}

/* ---------------- Badge ---------------- */
type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'brand';
export function Badge(props: { children: React.ReactNode; tone?: Tone; className?: string }) {
  const tones: Record<Tone, string> = {
    success: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-500/10 dark:text-emerald-300',
    warning: 'bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-500/10 dark:text-amber-300',
    danger: 'bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-500/10 dark:text-rose-300',
    info: 'bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-500/10 dark:text-sky-300',
    neutral: 'bg-slate-100 text-slate-600 ring-slate-500/20 dark:bg-slate-800 dark:text-slate-300',
    brand: 'bg-brand-50 text-brand-700 ring-brand-600/20 dark:bg-brand-500/15 dark:text-brand-300',
  };
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset', tones[props.tone || 'neutral'], props.className)}>
      {props.children}
    </span>
  );
}

/* ---------------- Progress ---------------- */
export function Progress(props: { value: number; tone?: 'brand' | 'success' | 'warning' | 'danger'; className?: string }) {
  const v = Math.max(0, Math.min(100, props.value));
  const tones = {
    brand: 'bg-brand-500',
    success: 'bg-emerald-500',
    warning: 'bg-amber-500',
    danger: 'bg-rose-500',
  };
  const tone = props.tone || (v >= 75 ? 'success' : v >= 50 ? 'warning' : 'danger');
  return (
    <div className={cx('h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800', props.className)}>
      <div className={cx('h-full rounded-full transition-all', tones[tone])} style={{ width: `${v}%` }} />
    </div>
  );
}

/* ---------------- Empty / loading ---------------- */
export function EmptyState(props: { icon?: React.ReactNode; title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center px-6 py-12 text-center">
      {props.icon && <div className="mb-3 text-slate-400">{props.icon}</div>}
      <h3 className="text-sm font-semibold">{props.title}</h3>
      {props.description && <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{props.description}</p>}
      {props.action && <div className="mt-4">{props.action}</div>}
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox(props: { error: unknown; className?: string }) {
  const message = props.error instanceof Error ? props.error.message : 'Something went wrong';
  return (
    <div className={cx('rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300', props.className)}>
      {message}
    </div>
  );
}

/* ---------------- Avatar ---------------- */
export function Avatar(props: { name: string; size?: 'sm' | 'md'; className?: string }) {
  const initials = props.name
    .split(/\s+/)
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span
      className={cx(
        'inline-flex items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-700 dark:bg-brand-500/20 dark:text-brand-300',
        props.size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-8 w-8 text-xs',
        props.className
      )}
      aria-hidden
    >
      {initials || '?'}
    </span>
  );
}

/* ---------------- Modal ---------------- */
export function Modal(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  React.useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open]);

  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-sm sm:p-8" role="dialog" aria-modal="true">
      <div className={cx('card w-full animate-fade-in', props.wide ? 'max-w-3xl' : 'max-w-lg')}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-800">
          <h3 className="text-sm font-semibold">{props.title}</h3>
          <button onClick={props.onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Close">
            ✕
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{props.children}</div>
        {props.footer && (
          <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-slate-800">{props.footer}</div>
        )}
      </div>
    </div>
  );
}

/* ---------------- Tabs ---------------- */
export function Tabs(props: {
  items: Array<{ key: string; label: string; badge?: React.ReactNode }>;
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-800', props.className)}>
      {props.items.map((item) => (
        <button
          key={item.key}
          onClick={() => props.onChange(item.key)}
          className={cx(
            'relative whitespace-nowrap px-3 py-2 text-sm font-medium transition',
            props.active === item.key
              ? 'text-brand-700 after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-brand-600 dark:text-brand-300'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          )}
        >
          {item.label} {item.badge}
        </button>
      ))}
    </div>
  );
}
