import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { useAuthStore } from '../store/auth';
import { api } from '../lib/api';
import { Avatar, Button, cx } from './ui';

interface NotifPayload {
  unread: number;
}

function useTheme() {
  const [dark, setDark] = useState(() => localStorage.getItem('rf_theme') === 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('rf_theme', dark ? 'dark' : 'light');
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export function AppShell() {
  const { user, workspaces, logout } = useAuthStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const theme = useTheme();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsOpen, setWsOpen] = useState(false);
  const [activeWs, setActiveWs] = useState<string>(() => localStorage.getItem('rf_ws') || '');

  const { data: notif } = useQuery({
    queryKey: ['notifications', 'count'],
    queryFn: () => api.get<NotifPayload>('/api/notifications'),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!activeWs && workspaces.length) {
      setActiveWs(workspaces[0].id);
      localStorage.setItem('rf_ws', workspaces[0].id);
    }
  }, [workspaces, activeWs]);

  const pickWorkspace = (id: string) => {
    setActiveWs(id);
    localStorage.setItem('rf_ws', id);
    setWsOpen(false);
    navigate('/app');
  };

  const handleLogout = async () => {
    await logout();
    queryClient.clear();
    navigate('/login');
  };

  const nav = [
    { to: '/app', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/app/projects/new', label: 'New project', icon: Plus },
    { to: '/app/notifications', label: 'Notifications', icon: Bell },
    ...(activeWs
      ? [
          { to: `/app/workspaces/${activeWs}/analytics`, label: 'Analytics', icon: BarChart3 },
          { to: `/app/workspaces/${activeWs}/settings`, label: 'Settings', icon: Settings },
        ]
      : []),
  ];

  const activeWorkspace = workspaces.find((w) => w.id === activeWs);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={cx(
          'fixed inset-y-0 left-0 z-40 w-60 transform border-r border-slate-200 bg-white transition-transform dark:border-slate-800 dark:bg-slate-900 lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link to="/app" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-600 text-white">
              <ShieldCheck className="h-4 w-4" />
            </span>
            ReadyForge
          </Link>
          <button className="lg:hidden" onClick={() => setMobileOpen(false)} aria-label="Close menu">
            <X className="h-5 w-5" />
          </button>
        </div>

        <nav className="mt-2 space-y-1 px-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cx(
                  'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition',
                  isActive
                    ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-6 px-6 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
          Principle
        </div>
        <p className="mt-2 px-6 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
          “Do not generate until the project is ready.”
        </p>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>

          {/* Workspace switcher */}
          <div className="relative">
            <button
              onClick={() => setWsOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800"
            >
              <span className="max-w-40 truncate">{activeWorkspace?.name || 'Select workspace'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
            </button>
            {wsOpen && (
              <div className="absolute left-0 top-11 z-30 w-64 rounded-lg border border-slate-200 bg-white p-1 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                {workspaces.map((w) => (
                  <button
                    key={w.id}
                    onClick={() => pickWorkspace(w.id)}
                    className="flex w-full items-center justify-between rounded px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <span className="truncate">{w.name}</span>
                    <span className="ml-2 text-[10px] uppercase text-slate-400">{w.role}</span>
                  </button>
                ))}
                <Link
                  to="/app/workspaces/new"
                  onClick={() => setWsOpen(false)}
                  className="mt-1 block rounded px-3 py-2 text-sm text-brand-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  + Create workspace
                </Link>
              </div>
            )}
          </div>

          <div className="flex-1" />

          <button
            onClick={theme.toggle}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Toggle theme"
          >
            {theme.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>

          <Link
            to="/app/notifications"
            className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {(notif?.unread ?? 0) > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">
                {notif!.unread > 9 ? '9+' : notif!.unread}
              </span>
            )}
          </Link>

          <div className="relative">
            <button
              onClick={() => setMenuOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <Avatar name={user?.name || '?'} size="sm" />
              <span className="hidden text-sm sm:block">{user?.name}</span>
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-11 z-30 w-56 rounded-lg border border-slate-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-900">
                <div className="px-2 py-1.5">
                  <p className="truncate text-sm font-medium">{user?.name}</p>
                  <p className="truncate text-xs text-slate-500">{user?.email}</p>
                </div>
                <div className="my-1 border-t border-slate-200 dark:border-slate-700" />
                <Button variant="ghost" className="w-full justify-start" onClick={handleLogout}>
                  <LogOut className="h-4 w-4" /> Sign out
                </Button>
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
