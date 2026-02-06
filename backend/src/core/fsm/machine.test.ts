import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/logger.js', () => ({
  createChildLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { ComponentFSM, FSMManager } from './machine.js';

describe('ComponentFSM', () => {
  let fsm: ComponentFSM;

  beforeEach(() => {
    fsm = new ComponentFSM('comp-1', 'map-1');
  });

  describe('initial state', () => {
    it('should start in unknown state by default', () => {
      expect(fsm.state).toBe('unknown');
    });

    it('should accept a custom initial state', () => {
      const custom = new ComponentFSM('comp-2', 'map-1', 'stopped');
      expect(custom.state).toBe('stopped');
    });

    it('should expose componentId', () => {
      expect(fsm.componentId).toBe('comp-1');
    });

    it('should expose context', () => {
      const ctx = fsm.getContext();
      expect(ctx.componentId).toBe('comp-1');
      expect(ctx.mapId).toBe('map-1');
      expect(ctx.currentState).toBe('unknown');
      expect(ctx.previousState).toBe('unknown');
      expect(ctx.consecutiveFailures).toBe(0);
    });
  });

  describe('transitions from unknown', () => {
    it('should transition to running on health_ok', () => {
      const result = fsm.send('health_ok');
      expect(result).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to stopped on health_fail', () => {
      const result = fsm.send('health_fail');
      expect(result).toBe(true);
      expect(fsm.state).toBe('stopped');
    });

    it('should transition to degraded on health_warning', () => {
      const result = fsm.send('health_warning');
      expect(result).toBe(true);
      expect(fsm.state).toBe('degraded');
    });

    it('should transition to starting on start', () => {
      const result = fsm.send('start');
      expect(result).toBe(true);
      expect(fsm.state).toBe('starting');
    });
  });

  describe('transitions from stopped', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
    });

    it('should transition to starting on start', () => {
      expect(fsm.send('start')).toBe(true);
      expect(fsm.state).toBe('starting');
    });

    it('should not transition on stop', () => {
      expect(fsm.send('stop')).toBe(false);
      expect(fsm.state).toBe('stopped');
    });
  });

  describe('transitions from starting', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start');
      expect(fsm.state).toBe('starting');
    });

    it('should transition to running on health_ok', () => {
      expect(fsm.send('health_ok')).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to running on command_completed', () => {
      expect(fsm.send('command_completed')).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to error on command_failed', () => {
      expect(fsm.send('command_failed')).toBe(true);
      expect(fsm.state).toBe('error');
    });

    it('should transition to error on command_timeout', () => {
      expect(fsm.send('command_timeout')).toBe(true);
      expect(fsm.state).toBe('error');
    });

    it('should transition to stopping on stop', () => {
      expect(fsm.send('stop')).toBe(true);
      expect(fsm.state).toBe('stopping');
    });
  });

  describe('transitions from running', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
    });

    it('should transition to degraded on health_fail', () => {
      expect(fsm.send('health_fail')).toBe(true);
      expect(fsm.state).toBe('degraded');
    });

    it('should transition to degraded on health_warning', () => {
      expect(fsm.send('health_warning')).toBe(true);
      expect(fsm.state).toBe('degraded');
    });

    it('should transition to stopping on stop', () => {
      expect(fsm.send('stop')).toBe(true);
      expect(fsm.state).toBe('stopping');
    });

    it('should transition to restarting on restart', () => {
      expect(fsm.send('restart')).toBe(true);
      expect(fsm.state).toBe('restarting');
    });

    it('should reset consecutive failures on health_ok (no transition)', () => {
      // Set some failures first
      fsm.send('health_fail'); // running -> degraded
      fsm.send('health_ok'); // degraded -> running
      expect(fsm.getContext().consecutiveFailures).toBe(0);
    });
  });

  describe('transitions from stopping', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      fsm.send('stop');
      expect(fsm.state).toBe('stopping');
    });

    it('should transition to stopped on health_fail', () => {
      expect(fsm.send('health_fail')).toBe(true);
      expect(fsm.state).toBe('stopped');
    });

    it('should transition to stopped on command_completed', () => {
      expect(fsm.send('command_completed')).toBe(true);
      expect(fsm.state).toBe('stopped');
    });

    it('should transition to error on command_failed', () => {
      expect(fsm.send('command_failed')).toBe(true);
      expect(fsm.state).toBe('error');
    });

    it('should transition to error on command_timeout', () => {
      expect(fsm.send('command_timeout')).toBe(true);
      expect(fsm.state).toBe('error');
    });
  });

  describe('transitions from restarting', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      fsm.send('restart');
      expect(fsm.state).toBe('restarting');
    });

    it('should transition to running on health_ok', () => {
      expect(fsm.send('health_ok')).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to running on command_completed', () => {
      expect(fsm.send('command_completed')).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to error on command_failed', () => {
      expect(fsm.send('command_failed')).toBe(true);
      expect(fsm.state).toBe('error');
    });

    it('should transition to error on command_timeout', () => {
      expect(fsm.send('command_timeout')).toBe(true);
      expect(fsm.state).toBe('error');
    });
  });

  describe('transitions from degraded', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      fsm.send('health_fail');
      expect(fsm.state).toBe('degraded');
    });

    it('should recover to running on health_ok', () => {
      expect(fsm.send('health_ok')).toBe(true);
      expect(fsm.state).toBe('running');
    });

    it('should transition to restarting on restart', () => {
      expect(fsm.send('restart')).toBe(true);
      expect(fsm.state).toBe('restarting');
    });

    it('should transition to stopping on stop', () => {
      expect(fsm.send('stop')).toBe(true);
      expect(fsm.state).toBe('stopping');
    });

    it('should transition to error after 5 consecutive failures', () => {
      // Already 1 failure from setup (running -> degraded, counter=1)
      // Guard checks counter BEFORE incrementing in no-transition path
      fsm.send('health_fail'); // guard sees 1, no transition, counter=2
      fsm.send('health_fail'); // guard sees 2, no transition, counter=3
      fsm.send('health_fail'); // guard sees 3, no transition, counter=4
      fsm.send('health_fail'); // guard sees 4, no transition, counter=5

      expect(fsm.state).toBe('degraded');

      // Next failure: guard sees counter=5, passes => transition to error
      fsm.send('health_fail');
      expect(fsm.state).toBe('error');
    });

    it('should stay degraded on health_fail below threshold', () => {
      // Already 1 failure from setup
      fsm.send('health_fail'); // failures=2
      expect(fsm.state).toBe('degraded');
    });
  });

  describe('transitions from error', () => {
    beforeEach(() => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'error');
    });

    it('should transition to stopped on acknowledge', () => {
      expect(fsm.send('acknowledge')).toBe(true);
      expect(fsm.state).toBe('stopped');
    });

    it('should transition to starting on start', () => {
      expect(fsm.send('start')).toBe(true);
      expect(fsm.state).toBe('starting');
    });
  });

  describe('context management', () => {
    it('should track previous state', () => {
      fsm.send('health_ok'); // unknown -> running
      const ctx = fsm.getContext();
      expect(ctx.previousState).toBe('unknown');
      expect(ctx.currentState).toBe('running');
    });

    it('should store jobId on command events', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start', { jobId: 'job-123' });
      expect(fsm.getContext().activeJobId).toBe('job-123');
    });

    it('should clear jobId on terminal states', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start', { jobId: 'job-123' });
      // starting -> running clears jobId
      fsm.send('health_ok');
      expect(fsm.getContext().activeJobId).toBeUndefined();
    });

    it('should track error message on command failure', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start');
      fsm.send('command_failed', { error: 'Connection refused' });
      expect(fsm.getContext().errorMessage).toBe('Connection refused');
    });

    it('should set default error message when no error data', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start');
      fsm.send('command_timeout');
      expect(fsm.getContext().errorMessage).toBe('Command command_timeout');
    });

    it('should clear error message on non-error transitions', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'stopped');
      fsm.send('start');
      fsm.send('command_failed', { error: 'fail' });
      expect(fsm.state).toBe('error');
      // Acknowledge => stopped, clears error
      fsm.send('acknowledge');
      // After transition to stopped (non-error), errorMessage cleared
      // Actually, acknowledge transitions to 'stopped' which is !== 'error'
      expect(fsm.getContext().errorMessage).toBeUndefined();
    });

    it('should track health check data', () => {
      fsm.send('health_ok', { message: 'All good' });
      const ctx = fsm.getContext();
      expect(ctx.lastHealthCheck).toBeDefined();
      expect(ctx.lastHealthCheck!.status).toBe('ok');
      expect(ctx.lastHealthCheck!.message).toBe('All good');
    });

    it('should track health_warning check data', () => {
      fsm.send('health_warning', { message: 'High load' });
      const ctx = fsm.getContext();
      expect(ctx.lastHealthCheck!.status).toBe('warning');
    });

    it('should track health_fail check data', () => {
      fsm.send('health_fail', { message: 'Down' });
      const ctx = fsm.getContext();
      expect(ctx.lastHealthCheck!.status).toBe('error');
    });

    it('should increment failures on health_fail without transition', () => {
      // In running state, health_fail has no more transitions after first one (goes to degraded)
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      fsm.send('health_fail'); // running -> degraded, failures=1
      fsm.send('health_fail'); // degraded, no guard match, failures incremented
      expect(fsm.getContext().consecutiveFailures).toBe(2);
    });

    it('should reset failures on health_ok without transition', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      // In running state, health_ok has no transition but should reset counter
      fsm.send('health_ok');
      expect(fsm.getContext().consecutiveFailures).toBe(0);
    });
  });

  describe('canSend', () => {
    it('should return true for valid events', () => {
      expect(fsm.canSend('health_ok')).toBe(true);
      expect(fsm.canSend('health_fail')).toBe(true);
      expect(fsm.canSend('start')).toBe(true);
    });

    it('should return false for invalid events from current state', () => {
      expect(fsm.canSend('restart')).toBe(false);
      expect(fsm.canSend('command_completed')).toBe(false);
    });
  });

  describe('possibleEvents', () => {
    it('should list possible events from unknown state', () => {
      const events = fsm.possibleEvents();
      expect(events).toContain('start');
      expect(events).toContain('health_ok');
      expect(events).toContain('health_fail');
      expect(events).toContain('health_warning');
    });

    it('should list possible events from running state', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'running');
      const events = fsm.possibleEvents();
      expect(events).toContain('stop');
      expect(events).toContain('restart');
      expect(events).toContain('health_fail');
      expect(events).toContain('health_warning');
    });

    it('should list possible events from error state', () => {
      fsm = new ComponentFSM('comp-1', 'map-1', 'error');
      const events = fsm.possibleEvents();
      expect(events).toContain('acknowledge');
      expect(events).toContain('start');
    });
  });
});

describe('FSMManager', () => {
  let manager: FSMManager;

  beforeEach(() => {
    manager = new FSMManager();
  });

  describe('getOrCreate', () => {
    it('should create a new FSM', () => {
      const fsm = manager.getOrCreate('comp-1', 'map-1');
      expect(fsm.state).toBe('unknown');
      expect(manager.size).toBe(1);
    });

    it('should return existing FSM', () => {
      const fsm1 = manager.getOrCreate('comp-1', 'map-1');
      const fsm2 = manager.getOrCreate('comp-1', 'map-1');
      expect(fsm1).toBe(fsm2);
    });

    it('should accept initial state', () => {
      const fsm = manager.getOrCreate('comp-1', 'map-1', 'running');
      expect(fsm.state).toBe('running');
    });
  });

  describe('get', () => {
    it('should return undefined for non-existent component', () => {
      expect(manager.get('nonexistent')).toBeUndefined();
    });

    it('should return existing FSM', () => {
      manager.getOrCreate('comp-1', 'map-1');
      expect(manager.get('comp-1')).toBeDefined();
    });
  });

  describe('processEvent', () => {
    it('should process event and return transition info', () => {
      const result = manager.processEvent({
        type: 'health_ok',
        componentId: 'comp-1',
        mapId: 'map-1',
        timestamp: new Date(),
      });

      expect(result.transitioned).toBe(true);
      expect(result.previousState).toBe('unknown');
      expect(result.currentState).toBe('running');
    });

    it('should emit transition event', () => {
      const handler = vi.fn();
      manager.on('transition', handler);

      manager.processEvent({
        type: 'health_ok',
        componentId: 'comp-1',
        mapId: 'map-1',
        timestamp: new Date(),
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        componentId: 'comp-1',
        previousState: 'unknown',
        currentState: 'running',
        event: 'health_ok',
      }));
    });

    it('should emit state-specific event', () => {
      const handler = vi.fn();
      manager.on('state:running', handler);

      manager.processEvent({
        type: 'health_ok',
        componentId: 'comp-1',
        mapId: 'map-1',
        timestamp: new Date(),
      });

      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        componentId: 'comp-1',
        previousState: 'unknown',
      }));
    });

    it('should not emit events when no transition occurs', () => {
      const handler = vi.fn();
      manager.on('transition', handler);

      // Create FSM in running state
      manager.getOrCreate('comp-1', 'map-1', 'running');

      // health_ok from running doesn't transition
      manager.processEvent({
        type: 'health_ok',
        componentId: 'comp-1',
        mapId: 'map-1',
        timestamp: new Date(),
      });

      expect(handler).not.toHaveBeenCalled();
    });

    it('should pass event data to FSM', () => {
      manager.processEvent({
        type: 'start',
        componentId: 'comp-1',
        mapId: 'map-1',
        timestamp: new Date(),
        data: { jobId: 'job-1' },
      });

      const fsm = manager.get('comp-1')!;
      expect(fsm.getContext().activeJobId).toBe('job-1');
    });
  });

  describe('getState', () => {
    it('should return unknown for non-existent component', () => {
      expect(manager.getState('nonexistent')).toBe('unknown');
    });

    it('should return current state', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      expect(manager.getState('comp-1')).toBe('running');
    });
  });

  describe('getMapStates', () => {
    it('should return empty array for map with no components', () => {
      expect(manager.getMapStates('map-1')).toEqual([]);
    });

    it('should return states for all components in a map', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'stopped');
      manager.getOrCreate('comp-3', 'map-2', 'running'); // different map

      const states = manager.getMapStates('map-1');
      expect(states).toHaveLength(2);
      expect(states).toContainEqual({ componentId: 'comp-1', state: 'running' });
      expect(states).toContainEqual({ componentId: 'comp-2', state: 'stopped' });
    });
  });

  describe('getMapHealth', () => {
    it('should return unknown for empty map', () => {
      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('unknown');
    });

    it('should return healthy when all components are running', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'running');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('healthy');
      expect(health.components.running).toBe(2);
    });

    it('should return unhealthy when any component is in error', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'error');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('unhealthy');
    });

    it('should return degraded when a component is degraded', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'degraded');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('degraded');
    });

    it('should return degraded when a component is starting', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'starting');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('degraded');
    });

    it('should return degraded when a component is stopping', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'stopping');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('degraded');
    });

    it('should return degraded when a component is restarting', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'restarting');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('degraded');
    });

    it('should return unknown when all components are unknown', () => {
      manager.getOrCreate('comp-1', 'map-1', 'unknown');
      manager.getOrCreate('comp-2', 'map-1', 'unknown');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('unknown');
    });

    it('should return degraded for mixed non-error non-running states', () => {
      manager.getOrCreate('comp-1', 'map-1', 'running');
      manager.getOrCreate('comp-2', 'map-1', 'stopped');

      const health = manager.getMapHealth('map-1');
      expect(health.status).toBe('degraded');
    });
  });

  describe('remove', () => {
    it('should remove an FSM', () => {
      manager.getOrCreate('comp-1', 'map-1');
      expect(manager.remove('comp-1')).toBe(true);
      expect(manager.get('comp-1')).toBeUndefined();
      expect(manager.size).toBe(0);
    });

    it('should return false for non-existent component', () => {
      expect(manager.remove('nonexistent')).toBe(false);
    });
  });

  describe('removeMap', () => {
    it('should remove all FSMs for a map', () => {
      manager.getOrCreate('comp-1', 'map-1');
      manager.getOrCreate('comp-2', 'map-1');
      manager.getOrCreate('comp-3', 'map-2');

      const removed = manager.removeMap('map-1');
      expect(removed).toBe(2);
      expect(manager.size).toBe(1);
      expect(manager.get('comp-3')).toBeDefined();
    });

    it('should return 0 for map with no components', () => {
      expect(manager.removeMap('nonexistent')).toBe(0);
    });
  });

  describe('clear', () => {
    it('should remove all FSMs', () => {
      manager.getOrCreate('comp-1', 'map-1');
      manager.getOrCreate('comp-2', 'map-2');
      manager.clear();
      expect(manager.size).toBe(0);
    });
  });
});
