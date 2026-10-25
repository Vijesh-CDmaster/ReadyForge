import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './ErrorBoundary';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard,
  Plus,
  Bell,
  LogOut,
  Moon,
  Sun,
  ShieldCheck,
  ChevronDown,
  Menu,
  X,
  BarChart3,
  Settings,
  ChevronsLeft,
  ChevronsRight,
  Search,
  ChevronRight,
  Palette,
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { api } from '../lib/api';
import { Avatar, Dropdown, cx } from './ui';
import { CommandPalette } from './CommandPalette';

interface NotifPayload {
  unread: number;
}

/** System preference is respected until the user makes an explicit choice. */
function useTheme() {
  const [dark, setDark] = useState(() => {
    const stored = localStorage.getItem('rf_theme');
    if (stored) return stored === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return {
    dark,
    toggle: () =>
      setDark((d) => {
        const next = !d;
        localStorage.setItem('rf_theme', next ? 'dark' : 'light');
        return next;
      }),
  };
}

/** Human labels for the project sub-routes (kept in sync with ProjectLayout tabs). */
const TAB_LABELS: Record<string, string> = {
  inputs: 'AI wizard',
  ledger: 'Ledger',
  conflicts: 'Conflicts',
  assets: 'Assets',
  rights: 'Rights',
  readiness: 'Readiness',
  risk: 'Cost at Risk',
  contract: 'Contract',
  ladder: 'Draft ladder',
  script: 'Script',
  storyboard: 'Storyboard',
  verification: 'Verify',
  lab: 'Campaign lab',
  provenance: 'Provenance',
  taste: 'Creative taste',
};

function Breadcrumbs({ projectTitle }: { projectTitle?: string }) {
  const { pathname } = useLocation();
  const segments = pathname.split('/').filter(Boolean); // e.g. app projects :id conflicts
  const crumbs: Array<{ label: string; to?: string }> = [];

  if (segments[0] === 'app') {
    let path = '';
    for (const seg of segments.slice(1)) {
      path += `/${seg}`;
      const isId = /^[a-f0-9]{24}$/.test(seg);
      if (isId) {
        crumbs.push({ label: projectTitle || 'Project', to: `/app/projects/${seg}` });
        continue;
      }
      if (seg === 'projects' && path === '/projects') continue;
      if (seg === 'workspaces') continue;
      const label =
        seg === 'new'
          ? segments.includes('projects')
            ? 'New project'
            : 'New workspace'
          : TAB_LABELS[seg] || seg.charAt(0).toUpperCase() + seg.slice(1);
      crumbs.push({ label, to: `/app${path}` });
    }
  }
  if (crumbs.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1 text-sm text-slate-500 md:flex">
      {crumbs.map((c, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-3 w-3 text-slate-400" aria-hidden />}
          {c.to && i < crumbs.length - 1 ? (
            <Link to={c.to} className="truncate hover:text-slate-800 dark:hover:text-slate-200">
              {c.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-slate-800 dark:text-slate-100" aria-current="page">
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function AppShell() {
  const { user, workspaces, logout } = useAuthStore();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('rf_sidebar') === 'collapsed');
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [activeWs, setActiveWs] = useState<string>(() => localStorage.getItem('rf_ws') || '');

  const { data: notif } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<NotifPayload>('/api/notifications'),
    refetchInterval: 30_000,
  });

  // Share the project-title cache with ProjectLayout (same query key).
  const projectId = pathname.match(/^\/app\/projects\/([a-f0-9]{24})/)?.[1];
  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<{ title: string }>(`/api/projects/${projectId}`),
    enabled: Boolean(projectId),
  });

  useEffect(() => {
    if (!activeWs && workspaces.length) {
      setActiveWs(workspaces[0].id);
      localStorage.setItem('rf_ws', workspaces[0].id);
    }
  }, [workspaces, activeWs]);

  // Ctrl/Cmd + K opens the command palette from anywhere in the app.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const pickWorkspace = (id: string) => {
    setActiveWs(id);
    localStorage.setItem('rf_ws', id);
    navigate('/app');
  };

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      localStorage.setItem('rf_sidebar', c ? 'expanded' : 'collapsed');
      return !c;
    });
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    navigate('/login');
  };

  const navGroups = [
    {
      label: 'Workspace',
      items: [
        { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
        { to: '/app/projects/new', label: 'New project', icon: Plus },
        { to: '/app/notifications', label: 'Notifications', icon: Bell, badge: notif?.unread || 0 },
        { to: '/app/taste', label: 'Creative Taste', icon: Palette },
        ...(activeWs
          ? [
              { to: `/app/workspaces/${activeWs}/analytics`, label: 'Analytics', icon: BarChart3 },
              { to: `/app/workspaces/${activeWs}/settings`, label: 'Settings', icon: Settings },
            ]
          : []),
      ],
    },
  ];

  const activeWorkspace = workspaces.find((w) => w.id === activeWs);

  const sidebarInner = (
    <>
      <div className={cx('flex h-14 items-center justify-between px-4', collapsed && 'justify-center px-2')}>
        <Link to="/app" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="ReadyForge dashboard">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white">
            <ShieldCheck className="h-4 w-4" aria-hidden />
          </span>
          {!collapsed && <span>ReadyForge</span>}
        </Link>
        <button
          className="rounded p-1 text-slate-400 hover:text-slate-600 lg:hidden dark:hover:text-slate-200"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="h-5 w-5" aria-hidden />
        </button>
      </div>

      <nav className="mt-2 flex-1 space-y-5 overflow-y-auto px-3" aria-label="Primary">
        {navGroups.map((group) => (
          <div key={group.label}>
            {!collapsed && (
              <div className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group.label}
              </div>
            )}
            <ul className="space-y-1">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    title={collapsed ? item.label : undefined}
                    onClick={() => setMobileOpen(false)}
                    className={({ isActive }) =>
                      cx(
                        'relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                        collapsed && 'justify-center px-0',
                        isActive
                          ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                      )
                    }
                  >
                    <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                    {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
                    {!collapsed && item.badge ? (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                        {item.badge > 9 ? '9+' : item.badge}
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className={cx('border-t border-slate-200 p-3 dark:border-slate-800', collapsed && 'px-2')}>
        {!collapsed && (
          <p className="mb-2 px-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
            “Do not generate until the project is ready.”
          </p>
        )}
        <button
          onClick={toggleCollapsed}
          className="hidden w-full items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-100 lg:flex dark:hover:bg-slate-800"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronsRight className="h-4 w-4" aria-hidden /> : <ChevronsLeft className="h-4 w-4" aria-hidden />}
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Sidebar — persistent on desktop, drawer on mobile */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-panel transition-[transform,width] duration-150 lg:static lg:translate-x-0',
          collapsed && 'lg:w-16',
          'border-r border-slate-200 dark:border-slate-800',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {sidebarInner}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} aria-hidden />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b sm:gap-3 border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
          <button
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden dark:hover:bg-slate-800"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>

          <Dropdown
            label="Switch workspace"
            align="left"
            triggerClassName="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            render={(close) => (
              <>
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    role="menuitem"
                    onClick={() => {
                      pickWorkspace(w.id);
                      close();
                    }}
                    className="flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="truncate">{w.name}</span>
                    <span className="ml-2 text-[10px] uppercase text-slate-400">{w.role}</span>
                  </button>
                ))}
                <Link
                  to="/app/workspaces/new"
                  onClick={close}
                  className="mt-1 block rounded px-3 py-2 text-sm text-brand-600 hover:bg-slate-100 dark:text-brand-300 dark:hover:bg-slate-800"
                >
                  + Create workspace
                </Link>
              </>
            )}
          >
            <span className="max-w-24 truncate sm:max-w-40">{activeWorkspace?.name || 'Select workspace'}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          </Dropdown>

          <Breadcrumbs projectTitle={project?.title} />

          <div className="flex-1" />

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm text-slate-400 hover:border-slate-300 hover:text-slate-600 sm:flex dark:border-slate-700 dark:hover:border-slate-600 dark:hover:text-slate-300"
            aria-label="Open command palette"
          >
            <Search className="h-3.5 w-3.5" aria-hidden />
            <span>Search…</span>
            <kbd className="kbd">⌘K</kbd>
          </button>

          <button
            onClick={theme.toggle}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={theme.dark ? 'Switch to light theme' : 'Switch to dark theme'}
          >
            {theme.dark ? <Sun className="h-4 w-4" aria-hidden /> : <Moon className="h-4 w-4" aria-hidden />}
          </button>

          <Link
            to="/app/notifications"
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label={`Notifications${(notif?.unread ?? 0) > 0 ? `, ${notif!.unread} unread` : ''}`}
          >
            <Bell className="h-4 w-4" aria-hidden />
            {(notif?.unread ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {notif!.unread > 9 ? '9+' : notif!.unread}
              </span>
            )}
          </Link>

          <Dropdown
            label="Account menu"
            align="right"
            triggerClassName="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            render={(close) => (
              <>
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <button
                  role="menuitem"
                  onClick={() => {
                    close();
                    void handleLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <LogOut className="h-4 w-4" aria-hidden /> Sign out
                </button>
              </>
            )}
          >
            <Avatar name={user?.name || '?'} size="sm" />
            <span className="hidden text-sm sm:block">{user?.name}</span>
          </Dropdown>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">
          <ErrorBoundary area="this page">
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        activeWs={activeWs}
        projectId={projectId}
        projectTitle={project?.title}
      />
    </div>
  );
}