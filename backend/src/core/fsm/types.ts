/**
 * Component Lifecycle FSM Types
 *
 * Defines the state machine for component lifecycle management.
 * Components transition between states based on commands and health checks.
 *
 * State diagram:
 *
 *   unknown ──check──> stopped/running
 *   stopped ──start──> starting ──health_ok──> running
 *   running ──stop──> stopping ──health_fail──> stopped
 *   running ──restart──> restarting ──health_ok──> running
 *   running ──health_fail──> degraded
 *   degraded ──health_ok──> running
 *   * ──error──> error
 *   error ──acknowledge──> stopped
 */

export type ComponentState =
  | 'unknown'
  | 'stopped'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'restarting'
  | 'degraded'
  | 'error';

export type ComponentEvent =
  | 'start'
  | 'stop'
  | 'restart'
  | 'health_ok'
  | 'health_warning'
  | 'health_fail'
  | 'command_sent'
  | 'command_completed'
  | 'command_failed'
  | 'command_timeout'
  | 'acknowledge'
  | 'check_result';

export interface StateTransition {
  from: ComponentState | ComponentState[];
  event: ComponentEvent;
  to: ComponentState;
  guard?: (context: ComponentContext) => boolean;
  action?: (context: ComponentContext) => void;
}

export interface ComponentContext {
  componentId: string;
  mapId: string;
  previousState: ComponentState;
  currentState: ComponentState;
  lastHealthCheck?: {
    status: 'ok' | 'warning' | 'error' | 'unknown';
    message?: string;
    timestamp: Date;
  };
  activeJobId?: string;
  errorMessage?: string;
  stateChangedAt: Date;
  consecutiveFailures: number;
  metadata: Record<string, unknown>;
}

export interface FSMEvent {
  type: ComponentEvent;
  componentId: string;
  mapId: string;
  timestamp: Date;
  data?: Record<string, unknown>;
}
