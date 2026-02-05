import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import type { Map, Component, MapPermissions } from '@/types';

// Maps
export function useMaps(workspaceId?: string) {
  return useQuery({
    queryKey: ['maps', workspaceId],
    queryFn: () =>
      api.get<{ data: Map[] }>('/api/v1/maps', workspaceId ? { workspaceId } : undefined),
    select: (data) => data.data,
  });
}

export function useMap(mapId: string) {
  return useQuery({
    queryKey: ['maps', mapId],
    queryFn: () => api.get<Map>(`/api/v1/maps/${mapId}`),
    enabled: !!mapId,
  });
}

export function useCreateMap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: {
      workspaceId: string;
      name: string;
      slug: string;
      description?: string;
    }) => api.post<Map>('/api/v1/maps', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maps'] });
    },
  });
}

export function useUpdateMap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mapId,
      data,
    }: {
      mapId: string;
      data: { name?: string; description?: string; yaml?: string };
    }) => api.put<Map>(`/api/v1/maps/${mapId}`, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['maps', variables.mapId] });
      queryClient.invalidateQueries({ queryKey: ['maps'] });
    },
  });
}

export function useDeleteMap() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mapId: string) => api.delete(`/api/v1/maps/${mapId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['maps'] });
    },
  });
}

// Components
export function useComponents(mapId: string) {
  return useQuery({
    queryKey: ['maps', mapId, 'components'],
    queryFn: () => api.get<{ data: Component[] }>(`/api/v1/maps/${mapId}/components`),
    select: (data) => data.data,
    enabled: !!mapId,
  });
}

export function useComponentAction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mapId,
      componentId,
      action,
    }: {
      mapId: string;
      componentId: string;
      action: 'start' | 'stop' | 'restart';
    }) => api.post(`/api/v1/maps/${mapId}/components/${componentId}/${action}`),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['maps', variables.mapId, 'components'],
      });
    },
  });
}

// Permissions
export function useMapPermissions(mapId: string) {
  return useQuery({
    queryKey: ['maps', mapId, 'permissions'],
    queryFn: () => api.get<MapPermissions>(`/api/v1/maps/${mapId}/permissions`),
    enabled: !!mapId,
  });
}

export function useGrantPermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mapId,
      email,
      role,
    }: {
      mapId: string;
      email: string;
      role: string;
    }) => api.post(`/api/v1/maps/${mapId}/permissions/users`, { email, role }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['maps', variables.mapId, 'permissions'],
      });
    },
  });
}

export function useRevokePermission() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ mapId, userId }: { mapId: string; userId: string }) =>
      api.delete(`/api/v1/maps/${mapId}/permissions/users/${userId}`),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['maps', variables.mapId, 'permissions'],
      });
    },
  });
}

export function useCreateShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      mapId,
      role,
      expiresAt,
    }: {
      mapId: string;
      role: string;
      expiresAt?: string;
    }) => api.post<{ url: string; token: string }>(`/api/v1/maps/${mapId}/share-links`, { role, expiresAt }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['maps', variables.mapId, 'permissions'],
      });
    },
  });
}
