import { useState } from 'react';
import { Play, Square, RotateCcw, X, Terminal, Activity, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, getStatusColor, getStatusText } from '@/lib/utils';
import { useJob } from '@/api/jobs';
import { JobStatusBadge } from './JobStatusToast';
import type { Component } from '@/types';

interface ComponentPanelProps {
  component: Component;
  onAction: (componentId: string, action: 'start' | 'stop' | 'restart') => Promise<{ jobId?: string }>;
  onClose: () => void;
  isLoading: boolean;
}

interface ActiveJob {
  id: string;
  action: string;
}

export function ComponentPanel({
  component,
  onAction,
  onClose,
  isLoading,
}: ComponentPanelProps) {
  const status = component.status || 'unknown';
  const actions = component.config.actions || [];
  const checks = component.config.checks || [];

  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const { data: jobData } = useJob(activeJob?.id || '');

  const handleAction = async (action: 'start' | 'stop' | 'restart') => {
    try {
      const result = await onAction(component.id, action);
      if (result?.jobId) {
        setActiveJob({ id: result.jobId, action });
      }
    } catch (error) {
      // Error handled by parent
    }
  };

  // Clear active job when it completes
  const isJobComplete = jobData && ['completed', 'failed', 'timeout'].includes(jobData.status);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div
            className={cn('h-4 w-4 rounded-full', getStatusColor(status))}
          />
          <span className="font-medium">{getStatusText(status)}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Active Job Status */}
      {activeJob && jobData && !isJobComplete && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium capitalize">{activeJob.action}</span>
            <JobStatusBadge status={jobData.status} />
          </div>
          {jobData.status === 'running' && (
            <div className="mt-2 flex items-center text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin mr-1" />
              Command is executing...
            </div>
          )}
        </div>
      )}

      {/* Job Result */}
      {activeJob && jobData && isJobComplete && (
        <div className={cn(
          "p-3 rounded-lg border",
          jobData.status === 'completed'
            ? "bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800"
            : "bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800"
        )}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium capitalize">{activeJob.action}</span>
            <JobStatusBadge status={jobData.status} />
          </div>
          {jobData.result && (
            <div className="space-y-1 text-xs">
              {jobData.result.stdout && (
                <pre className="p-2 rounded bg-background/50 overflow-x-auto max-h-24">
                  {jobData.result.stdout.slice(0, 500)}
                </pre>
              )}
              {jobData.result.stderr && (
                <pre className="p-2 rounded bg-background/50 text-red-600 overflow-x-auto max-h-24">
                  {jobData.result.stderr.slice(0, 500)}
                </pre>
              )}
              <div className="text-muted-foreground">
                Exit code: {jobData.result.exitCode} | Duration: {jobData.result.durationMs}ms
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 text-xs"
            onClick={() => setActiveJob(null)}
          >
            Dismiss
          </Button>
        </div>
      )}

      {/* Info */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Type</span>
          <span className="font-medium">{component.type}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">ID</span>
          <span className="font-mono text-xs">{component.externalId}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-2">
        <h4 className="text-sm font-medium">Actions</h4>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('start')}
            disabled={isLoading || (activeJob && !isJobComplete)}
          >
            {isLoading && activeJob?.action === 'start' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('stop')}
            disabled={isLoading || (activeJob && !isJobComplete)}
          >
            {isLoading && activeJob?.action === 'stop' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Square className="h-4 w-4 mr-1" />
            )}
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => handleAction('restart')}
            disabled={isLoading || (activeJob && !isJobComplete)}
          >
            {isLoading && activeJob?.action === 'restart' ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-1" />
            )}
            Restart
          </Button>
        </div>
      </div>

      {/* Custom Actions */}
      {actions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Custom Actions</h4>
          <div className="flex flex-wrap gap-2">
            {actions.map((action) => (
              <Button
                key={action.name}
                size="sm"
                variant="secondary"
                disabled={isLoading || (activeJob && !isJobComplete)}
              >
                <Terminal className="h-4 w-4 mr-1" />
                {action.label || action.name}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Checks */}
      {checks.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium flex items-center">
            <Activity className="h-4 w-4 mr-2" />
            Health Checks
          </h4>
          <div className="space-y-1">
            {checks.map((check) => (
              <div
                key={check.name}
                className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm"
              >
                <span>{check.name}</span>
                <span className="text-xs text-muted-foreground">
                  {check.type} / {check.intervalSecs}s
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dependencies */}
      {component.config.dependencies && component.config.dependencies.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium">Dependencies</h4>
          <div className="flex flex-wrap gap-1">
            {component.config.dependencies.map((dep) => (
              <span
                key={dep}
                className="px-2 py-1 rounded bg-muted text-xs font-mono"
              >
                {dep}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
