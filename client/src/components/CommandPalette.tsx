import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search } from 'lucide-react';
import { cx } from './ui';

interface Command {
  id: string;
  label: string;
  hint?: string;
  to: string;
  group: string;
}

/**
 * Ctrl/Cmd+K palette over routes that actually exist (UI_AUDIT plan #6).
 * No invented actions: everything here navigates to a real page.
 */
export function CommandPalette(props: {
  open: boolean;
  onClose: () => void;
  activeWs: string;
  projectId?: string;
  projectTitle?: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (props.open) {
      previouslyFocused.current = document.activeElement as HTMLElement | null;
      setQuery('');
      setCursor(0);
      // Focus after paint so the animated panel is interactive immediately.
      const t = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(t);
    }
    previouslyFocused.current?.focus();
  }, [props.open]);

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'dash', label: 'Dashboard', group: 'Go to', to: '/app' },
      { id: 'newp', label: 'New project', group: 'Go to', to: '/app/projects/new' },
      { id: 'neww', label: 'New workspace', group: 'Go to', to: '/app/workspaces/new' },
      { id: 'notif', label: 'Notifications', group: 'Go to', to: '/app/notifications' },
      { id: 'taste', label: 'Creative Taste DNA', group: 'Go to', to: '/app/taste' },
    ];
    if (props.activeWs) {
      base.push(
        { id: 'analytics', label: 'Analytics', group: 'Workspace', to: `/app/workspaces/${props.activeWs}/analytics` },
        { id: 'settings', label: 'Workspace settings', group: 'Workspace', to: `/app/workspaces/${props.activeWs}/settings` }
      );
    }
    if (props.projectId) {
      const p = `/app/projects/${props.projectId}`;
      const title = props.projectTitle || 'Current project';
      const tabs: Array<[string, string]> = [
        ['', 'Overview'],
        ['inputs', 'AI wizard'],
        ['ledger', 'Knowledge ledger'],
        ['conflicts', 'Conflict room'],
        ['assets', 'Asset library'],
        ['rights', 'Rights & licences'],
        ['readiness', 'Readiness'],
        ['risk', 'Cost at Risk'],
        ['contract', 'Production contract'],
        ['ladder', 'Draft ladder'],
        ['script', 'Script editor'],
        ['storyboard', 'Storyboard editor'],
        ['verification', 'Verification report'],
        ['lab', 'Campaign lab'],
        ['taste', 'Creative taste'],
        ['provenance', 'Provenance passport'],
      ];
      for (const [seg, label] of tabs) {
        base.push({ id: `p-${seg || 'overview'}`, label, hint: title, group: 'This project', to: seg ? `${p}/${seg}` : p });
      }
    }
    return base;
  }, [props.activeWs, props.projectId, props.projectTitle]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    );
  }, [commands, query]);

  useEffect(() => {
    setCursor(0);
  }, [query]);

  useEffect(() => {
    if (!props.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[cursor];
        if (cmd) {
          props.onClose();
          navigate(cmd.to);
        }
      } else if (e.key === 'Tab') {
        const dialog = document.querySelector<HTMLElement>('[aria-label="Command palette"]');
        const items = dialog
          ? Array.from(dialog.querySelectorAll<HTMLElement>('input, button, [href], [tabindex]:not([tabindex="-1"])')).filter(
              (el) => !el.hasAttribute('disabled')
            )
          : [];
        if (items.length) {
          e.preventDefault();
          const current = items.indexOf(document.activeElement as HTMLElement);
          const next = e.shiftKey ? (current - 1 + items.length) % items.length : (current + 1) % items.length;
          items[next].focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [props.open, filtered, cursor, navigate]);

  // Keep the highlighted row visible while arrowing through a long list.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!props.open) return null;

  let lastGroup = '';
  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-950/50 p-4 pt-[12vh] backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="card w-full max-w-lg animate-scale-in overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 dark:border-slate-800">
          <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search pages and actions…"
            aria-label="Search pages and actions"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-slate-400"
            role="combobox"
            aria-expanded
            aria-controls="command-list"
            aria-activedescendant={filtered[cursor] ? `cmd-${filtered[cursor].id}` : undefined}
          />
          <kbd className="kbd">Esc</kbd>
        </div>
        <div id="command-list" role="listbox" aria-label="Commands" ref={listRef} className="max-h-72 overflow-y-auto p-1.5">
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-slate-500">No matches for “{query}”.</p>
          )}
          {filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            return (
              <div key={cmd.id}>
                {showGroup && (
                  <div className="px-3 pb-1 pt-2.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {cmd.group}
                  </div>
                )}
                <button
                  id={`cmd-${cmd.id}`}
                  data-idx={i}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => {
                    props.onClose();
                    navigate(cmd.to);
                  }}
                  className={cx(
                    'flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors',
                    i === cursor ? 'bg-brand-500/15 text-brand-700 dark:text-brand-300' : 'text-slate-700 dark:text-slate-300'
                  )}
                >
                  <span className="truncate">{cmd.label}</span>
                  <span className="flex items-center gap-2">
                    {cmd.hint && <span className="truncate text-xs text-slate-400">{cmd.hint}</span>}
                    {i === cursor && <CornerDownLeft className="h-3 w-3 text-slate-400" aria-hidden />}
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}