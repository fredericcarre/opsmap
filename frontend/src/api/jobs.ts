import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export interface Job {
  id: string;
  type: 'command' | 'action' | 'check';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  mapId?: string;
  componentId?: string;
  agentId: string;
  command: string;
  args: string[];
  result?: {
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  };
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export function useJob(jobId: string) {
  return useQuery({
    queryKey: ['jobs', jobId],
    queryFn: () => api.get<Job>(`/api/v1/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const data = query.state.data;
      // Stop polling once job is complete
      if (data && ['completed', 'failed', 'timeout'].includes(data.status)) {
        return false;
      }
      return 1000; // Poll every second while job is running
    },
  });
}

export function useWaitForJob(jobId: string) {
  return useQuery({
    queryKey: ['jobs', jobId, 'wait'],
    queryFn: () => api.get<Job>(`/api/v1/jobs/${jobId}/wait?timeout=30000`),
    enabled: !!jobId,
  });
}

// Hook to track multiple jobs
export function useJobTracker() {
  const queryClient = useQueryClient();
  const trackedJobs = new Map<string, Job>();

  const trackJob = (jobId: string) => {
    // Start polling this job
    queryClient.prefetchQuery({
      queryKey: ['jobs', jobId],
      queryFn: () => api.get<Job>(`/api/v1/jobs/${jobId}`),
    });
  };

  const getJob = (jobId: string): Job | undefined => {
    const data = queryClient.getQueryData<Job>(['jobs', jobId]);
    return data;
  };

  const isJobComplete = (jobId: string): boolean => {
    const job = getJob(jobId);
    return !!job && ['completed', 'failed', 'timeout'].includes(job.status);
  };

  return { trackJob, getJob, isJobComplete };
}
