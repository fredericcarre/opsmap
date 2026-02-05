import { useEffect } from 'react';
import { CheckCircle, XCircle, Loader2, Clock } from 'lucide-react';
import { useJob, Job } from '@/api/jobs';
import { useToast } from '@/hooks/use-toast';

interface JobStatusToastProps {
  jobId: string;
  actionName: string;
  componentName: string;
  onComplete?: (job: Job) => void;
}

export function useJobStatusToast() {
  const { toast } = useToast();

  const trackJob = (jobId: string, actionName: string, componentName: string) => {
    // Show initial toast
    toast({
      title: `${actionName} started`,
      description: `Running ${actionName} on ${componentName}...`,
      duration: 3000,
    });

    return jobId;
  };

  return { trackJob };
}

export function JobStatusTracker({
  jobId,
  actionName,
  componentName,
  onComplete,
}: JobStatusToastProps) {
  const { data: job, isLoading } = useJob(jobId);
  const { toast } = useToast();

  useEffect(() => {
    if (!job) return;

    if (job.status === 'completed') {
      toast({
        title: `${actionName} completed`,
        description: `Successfully completed ${actionName} on ${componentName}`,
        duration: 5000,
      });
      onComplete?.(job);
    } else if (job.status === 'failed') {
      toast({
        title: `${actionName} failed`,
        description: job.result?.stderr || 'Command failed',
        variant: 'destructive',
        duration: 10000,
      });
      onComplete?.(job);
    } else if (job.status === 'timeout') {
      toast({
        title: `${actionName} timed out`,
        description: `The command timed out after waiting`,
        variant: 'destructive',
        duration: 10000,
      });
      onComplete?.(job);
    }
  }, [job?.status]);

  return null; // This component only triggers toasts
}

// Inline job status indicator for UI
export function JobStatusBadge({ status }: { status: Job['status'] }) {
  switch (status) {
    case 'pending':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <Clock className="h-3 w-3" />
          Pending
        </span>
      );
    case 'running':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-blue-500">
          <Loader2 className="h-3 w-3 animate-spin" />
          Running
        </span>
      );
    case 'completed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-green-500">
          <CheckCircle className="h-3 w-3" />
          Completed
        </span>
      );
    case 'failed':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-red-500">
          <XCircle className="h-3 w-3" />
          Failed
        </span>
      );
    case 'timeout':
      return (
        <span className="inline-flex items-center gap-1 text-xs text-yellow-500">
          <Clock className="h-3 w-3" />
          Timeout
        </span>
      );
    default:
      return null;
  }
}
