import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@/types';
import { api } from '@/api/client';

interface AuthState {
  user: User | null;
  token: string | null;
  refreshToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshAuth: () => Promise<void>;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      token: null,
      refreshToken: null,
      isAuthenticated: false,
      isLoading: true,

      login: async (email: string, password: string) => {
        const response = await api.post<{
          user: User;
          token: string;
          refreshToken: string;
        }>('/api/v1/auth/login', { email, password });

        set({
          user: response.user,
          token: response.token,
          refreshToken: response.refreshToken,
          isAuthenticated: true,
          isLoading: false,
        });
      },

      logout: () => {
        set({
          user: null,
          token: null,
          refreshToken: null,
          isAuthenticated: false,
          isLoading: false,
        });
      },

      refreshAuth: async () => {
        const { refreshToken } = get();
        if (!refreshToken) {
          set({ isLoading: false });
          return;
        }

        try {
          const response = await api.post<{
            user: User;
            token: string;
            refreshToken: string;
          }>('/api/v1/auth/refresh', { refreshToken });

          set({
            user: response.user,
            token: response.token,
            refreshToken: response.refreshToken,
            isAuthenticated: true,
            isLoading: false,
          });
        } catch {
          set({
            user: null,
            token: null,
            refreshToken: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      setLoading: (loading: boolean) => set({ isLoading: loading }),
    }),
    {
      name: 'opsmap-auth',
      partialize: (state) => ({
        token: state.token,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setLoading(false);
        }
      },
    }
  )
);
