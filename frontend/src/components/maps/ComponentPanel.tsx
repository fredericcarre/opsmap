import { Play, Square, RotateCcw, X, Terminal, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn, getStatusColor, getStatusText } from '@/lib/utils';
import type { Component } from '@/types';

interface ComponentPanelProps {
  component: Component;
  onAction: (componentId: string, action: 'start' | 'stop' | 'restart') => void;
  onClose: () => void;
  isLoading: boolean;
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
            onClick={() => onAction(component.id, 'start')}
            disabled={isLoading || status === 'ok'}
          >
            <Play className="h-4 w-4 mr-1" />
            Start
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(component.id, 'stop')}
            disabled={isLoading || status === 'error'}
          >
            <Square className="h-4 w-4 mr-1" />
            Stop
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onAction(component.id, 'restart')}
            disabled={isLoading}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
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
                disabled={isLoading}
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
