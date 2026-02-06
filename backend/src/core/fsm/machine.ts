import { EventEmitter } from 'events';
import { createChildLogger } from '../../config/logger.js';
import {
  ComponentState,
  ComponentEvent,
  ComponentContext,
  StateTransition,
  FSMEvent,
} from './types.js';

const logger = createChildLogger('fsm');

/**
 * State transition table defining valid state changes.
 * Each transition can have an optional guard (condition) and action (side effect).
 */
const transitions: StateTransition[] = [
  // Start
  { from: ['stopped', 'unknown', 'error'], event: 'start', to: 'starting' },

  // Stop
  { from: ['running', 'degraded', 'starting'], event: 'stop', to: 'stopping' },

  // Restart
  { from: ['running', 'degraded'], event: 'restart', to: 'restarting' },

  // Command results during starting
  { from: 'starting', event: 'health_ok', to: 'running' },
  { from: 'starting', event: 'command_completed', to: 'running' },
  { from: 'starting', event: 'command_failed', to: 'error' },
  { from: 'starting', event: 'command_timeout', to: 'error' },

  // Command results during stopping
  { from: 'stopping', event: 'health_fail', to: 'stopped' },
  { from: 'stopping', event: 'command_completed', to: 'stopped' },
  { from: 'stopping', event: 'command_failed', to: 'error' },
  { from: 'stopping', event: 'command_timeout', to: 'error' },

  // Command results during restarting
  { from: 'restarting', event: 'health_ok', to: 'running' },
  { from: 'restarting', event: 'command_completed', to: 'running' },
  { from: 'restarting', event: 'command_failed', to: 'error' },
  { from: 'restarting', event: 'command_timeout', to: 'error' },

  // Health checks during running
  { from: 'running', event: 'health_fail', to: 'degraded' },
  { from: 'running', event: 'health_warning', to: 'degraded' },

  // Recovery from degraded
  { from: 'degraded', event: 'health_ok', to: 'running' },
  // Stay degraded on continued failures (no transition needed, handled by guard)
  {
    from: 'degraded',
    event: 'health_fail',
    to: 'error',
    guard: (ctx) => ctx.consecutiveFailures >= 5,
  },

  // Unknown state resolution
  { from: 'unknown', event: 'health_ok', to: 'running' },
  { from: 'unknown', event: 'health_fail', to: 'stopped' },
  { from: 'unknown', event: 'health_warning', to: 'degraded' },

  // Error acknowledgement
  { from: 'error', event: 'acknowledge', to: 'stopped' },
];

/**
 * ComponentFSM manages the lifecycle state of a single component.
 */
export class ComponentFSM {
  private context: ComponentContext;

  constructor(componentId: string, mapId: string, initialState: ComponentState = 'unknown') {
    this.context = {
      componentId,
      mapId,
      previousState: initialState,
      currentState: initialState,
      stateChangedAt: new Date(),
      consecutiveFailures: 0,
      metadata: {},
    };
  }

  get state(): ComponentState {
    return this.context.currentState;
  }

  get componentId(): string {
    return this.context.componentId;
  }

  getContext(): Readonly<ComponentContext> {
    return { ...this.context };
  }

  /**
   * Attempt to transition the FSM based on an event.
   * Returns true if a transition occurred, false if the event was ignored.
   */
  send(event: ComponentEvent, data?: Record<string, unknown>): boolean {
    const currentState = this.context.currentState;

    // Find a matching transition
    const transition = transitions.find((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      if (!fromStates.includes(currentState)) return false;
      if (t.event !== event) return false;
      if (t.guard && !t.guard(this.context)) return false;
      return true;
    });

    if (!transition) {
      // Event doesn't trigger a transition from current state
      // Update context metadata but don't change state
      if (event === 'health_fail') {
        this.context.consecutiveFailures++;
      }
      if (event === 'health_ok') {
        this.context.consecutiveFailures = 0;
      }
      return false;
    }

    // Execute transition
    const previousState = this.context.currentState;
    this.context.previousState = previousState;
    this.context.currentState = transition.to;
    this.context.stateChangedAt = new Date();

    // Update counters
    if (event === 'health_fail' || event === 'command_failed') {
      this.context.consecutiveFailures++;
    }
    if (event === 'health_ok' || event === 'command_completed') {
      this.context.consecutiveFailures = 0;
    }

    // Store job ID for command events
    if (data?.jobId) {
      this.context.activeJobId = data.jobId as string;
    }
    if (transition.to === 'running' || transition.to === 'stopped' || transition.to === 'error') {
      this.context.activeJobId = undefined;
    }

    // Store error messages
    if (event === 'command_failed' || event === 'command_timeout') {
      this.context.errorMessage = (data?.error as string) || `Command ${event}`;
    }
    if (transition.to !== 'error') {
      this.context.errorMessage = undefined;
    }

    // Store health check data
    if (event === 'health_ok' || event === 'health_fail' || event === 'health_warning') {
      this.context.lastHealthCheck = {
        status: event === 'health_ok' ? 'ok' : event === 'health_warning' ? 'warning' : 'error',
        message: data?.message as string | undefined,
        timestamp: new Date(),
      };
    }

    // Execute action
    if (transition.action) {
      transition.action(this.context);
    }

    logger.debug(
      { componentId: this.context.componentId, from: previousState, to: transition.to, event },
      'FSM state transition'
    );

    return true;
  }

  /**
   * Check if an event would cause a transition from the current state.
   */
  canSend(event: ComponentEvent): boolean {
    return transitions.some((t) => {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      if (!fromStates.includes(this.context.currentState)) return false;
      if (t.event !== event) return false;
      if (t.guard && !t.guard(this.context)) return false;
      return true;
    });
  }

  /**
   * Get all possible events from the current state.
   */
  possibleEvents(): ComponentEvent[] {
    const events = new Set<ComponentEvent>();
    for (const t of transitions) {
      const fromStates = Array.isArray(t.from) ? t.from : [t.from];
      if (fromStates.includes(this.context.currentState)) {
        if (!t.guard || t.guard(this.context)) {
          events.add(t.event);
        }
      }
    }
    return Array.from(events);
  }
}

/**
 * FSMManager manages FSMs for all components across all maps.
 * Emits events when component states change.
 */
export class FSMManager extends EventEmitter {
  private machines: Map<string, ComponentFSM> = new Map();

  /**
   * Get or create an FSM for a component.
   */
  getOrCreate(componentId: string, mapId: string, initialState?: ComponentState): ComponentFSM {
    let fsm = this.machines.get(componentId);
    if (!fsm) {
      fsm = new ComponentFSM(componentId, mapId, initialState);
      this.machines.set(componentId, fsm);
    }
    return fsm;
  }

  /**
   * Get an existing FSM. Returns undefined if not found.
   */
  get(componentId: string): ComponentFSM | undefined {
    return this.machines.get(componentId);
  }

  /**
   * Process an event for a component, creating the FSM if needed.
   */
  processEvent(event: FSMEvent): { transitioned: boolean; previousState: ComponentState; currentState: ComponentState } {
    const fsm = this.getOrCreate(event.componentId, event.mapId);
    const previousState = fsm.state;

    const transitioned = fsm.send(event.type, event.data);

    if (transitioned) {
      this.emit('transition', {
        componentId: event.componentId,
        mapId: event.mapId,
        previousState,
        currentState: fsm.state,
        event: event.type,
        timestamp: event.timestamp,
      });

      // Emit specific state events
      this.emit(`state:${fsm.state}`, {
        componentId: event.componentId,
        mapId: event.mapId,
        previousState,
      });
    }

    return { transitioned, previousState, currentState: fsm.state };
  }

  /**
   * Get the state of a component.
   */
  getState(componentId: string): ComponentState {
    return this.machines.get(componentId)?.state || 'unknown';
  }

  /**
   * Get states for all components in a map.
   */
  getMapStates(mapId: string): Array<{ componentId: string; state: ComponentState }> {
    const results: Array<{ componentId: string; state: ComponentState }> = [];
    for (const [componentId, fsm] of this.machines) {
      if (fsm.getContext().mapId === mapId) {
        results.push({ componentId, state: fsm.state });
      }
    }
    return results;
  }

  /**
   * Get aggregate map health status.
   */
  getMapHealth(mapId: string): { status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown'; components: Record<ComponentState, number> } {
    const states = this.getMapStates(mapId);
    const counts: Record<string, number> = {};
    for (const s of states) {
      counts[s.state] = (counts[s.state] || 0) + 1;
    }

    let status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
    if (states.length === 0) {
      status = 'unknown';
    } else if (counts['error'] > 0) {
      status = 'unhealthy';
    } else if (counts['degraded'] > 0 || counts['starting'] > 0 || counts['stopping'] > 0 || counts['restarting'] > 0) {
      status = 'degraded';
    } else if (counts['running'] === states.length) {
      status = 'healthy';
    } else if (counts['unknown'] === states.length) {
      status = 'unknown';
    } else {
      status = 'degraded';
    }

    return { status, components: counts as Record<ComponentState, number> };
  }

  /**
   * Remove an FSM for a component (e.g., when component is deleted).
   */
  remove(componentId: string): boolean {
    return this.machines.delete(componentId);
  }

  /**
   * Remove all FSMs for a map.
   */
  removeMap(mapId: string): number {
    let removed = 0;
    for (const [componentId, fsm] of this.machines) {
      if (fsm.getContext().mapId === mapId) {
        this.machines.delete(componentId);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Get the total number of tracked components.
   */
  get size(): number {
    return this.machines.size;
  }

  /**
   * Clear all FSMs.
   */
  clear(): void {
    this.machines.clear();
  }
}

/** Singleton FSM manager instance */
export const fsmManager = new FSMManager();
