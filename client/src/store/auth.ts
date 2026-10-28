import { create } from 'zustand';
import { api, setAccessToken, getStoredToken, setUnauthorizedHandler } from '../lib/api';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  avatarUrl: string;
  platformRole: 'user' | 'admin';
  isVerified?: boolean;
  language?: string;
  timezone?: string;
}

export interface WorkspaceSummary {
  id: string;
  name: string;
  description?: string;
  role?: string;
  ownerId?: string;
}

interface AuthState {
  user: SessionUser | null;
  workspaces: WorkspaceSummary[];
  status: 'idle' | 'loading' | 'ready';
  bootstrap: () => Promise<void>;
  applySession: (token: string, user: SessionUser) => Promise<void>;
  refreshMe: () => Promise<void>;
  logout: () => Promise<void>;
}

async function loadMe() {
  const data = await api.get<{ user: SessionUser; workspaces: WorkspaceSummary[] }>('/api/auth/me');
  return data;
}

export const useAuthStore = create<AuthState>((set, getState) => ({
  user: null,
  workspaces: [],
  status: 'idle',

  bootstrap: async () => {
    if (getState().status !== 'idle') return;
    set({ status: 'loading' });
    setUnauthorizedHandler(() => set({ user: null, workspaces: [], status: 'idle' }));
    const token = getStoredToken();
    if (!token) {
      set({ status: 'ready' });
      return;
    }
    try {
      const data = await loadMe();
      set({ user: data.user, workspaces: data.workspaces, status: 'ready' });
    } catch {
      setAccessToken(null);
      set({ user: null, workspaces: [], status: 'ready' });
    }
  },

  applySession: async (token, user) => {
    setAccessToken(token);
    set({ user, status: 'ready' });
    await getState().refreshMe();
  },

  refreshMe: async () => {
    try {
      const data = await loadMe();
      set({ user: data.user, workspaces: data.workspaces });
    } catch (err) {
      console.warn('refreshMe failed', err);
    }
  },

  logout: async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* ignore */
    }
    setAccessToken(null);
    set({ user: null, workspaces: [], status: 'ready' });
  },
}));
