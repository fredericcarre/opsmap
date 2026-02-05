import { getPool } from '../connection.js';
import { Job, JobResult } from '../../types/index.js';

export interface CreateJobParams {
  type: 'command' | 'action' | 'check';
  mapId?: string;
  componentId?: string;
  agentId: string;
  command: string;
  args?: string[];
  createdBy: string;
}

export interface UpdateJobParams {
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  result?: JobResult;
  startedAt?: Date;
  completedAt?: Date;
}

export const jobsRepository = {
  async create(params: CreateJobParams): Promise<Job> {
    const pool = getPool();
    const result = await pool.query<Job>(
      `INSERT INTO jobs (type, map_id, component_id, agent_id, command, args, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING
         id, type, status,
         map_id as "mapId",
         component_id as "componentId",
         agent_id as "agentId",
         command, args, result,
         created_at as "createdAt",
         started_at as "startedAt",
         completed_at as "completedAt",
         created_by as "createdBy"`,
      [
        params.type,
        params.mapId || null,
        params.componentId || null,
        params.agentId,
        params.command,
        JSON.stringify(params.args || []),
        params.createdBy,
      ]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Job | null> {
    const pool = getPool();
    const result = await pool.query<Job>(
      `SELECT
         id, type, status,
         map_id as "mapId",
         component_id as "componentId",
         agent_id as "agentId",
         command, args, result,
         created_at as "createdAt",
         started_at as "startedAt",
         completed_at as "completedAt",
         created_by as "createdBy"
       FROM jobs WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async update(id: string, params: UpdateJobParams): Promise<Job | null> {
    const pool = getPool();
    const updates: string[] = [];
    const values: unknown[] = [];
    let paramIndex = 1;

    if (params.status !== undefined) {
      updates.push(`status = $${paramIndex++}`);
      values.push(params.status);
    }
    if (params.result !== undefined) {
      updates.push(`result = $${paramIndex++}`);
      values.push(JSON.stringify(params.result));
    }
    if (params.startedAt !== undefined) {
      updates.push(`started_at = $${paramIndex++}`);
      values.push(params.startedAt);
    }
    if (params.completedAt !== undefined) {
      updates.push(`completed_at = $${paramIndex++}`);
      values.push(params.completedAt);
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    values.push(id);
    const result = await pool.query<Job>(
      `UPDATE jobs SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING
         id, type, status,
         map_id as "mapId",
         component_id as "componentId",
         agent_id as "agentId",
         command, args, result,
         created_at as "createdAt",
         started_at as "startedAt",
         completed_at as "completedAt",
         created_by as "createdBy"`,
      values
    );
    return result.rows[0] || null;
  },

  async markStarted(id: string): Promise<Job | null> {
    return this.update(id, {
      status: 'running',
      startedAt: new Date(),
    });
  },

  async markCompleted(id: string, result: JobResult): Promise<Job | null> {
    return this.update(id, {
      status: result.exitCode === 0 ? 'completed' : 'failed',
      result,
      completedAt: new Date(),
    });
  },

  async markFailed(id: string, error: string): Promise<Job | null> {
    return this.update(id, {
      status: 'failed',
      result: {
        exitCode: -1,
        stdout: '',
        stderr: error,
        durationMs: 0,
        timedOut: false,
      },
      completedAt: new Date(),
    });
  },

  async markTimeout(id: string): Promise<Job | null> {
    return this.update(id, {
      status: 'timeout',
      result: {
        exitCode: -1,
        stdout: '',
        stderr: 'Command timed out',
        durationMs: 0,
        timedOut: true,
      },
      completedAt: new Date(),
    });
  },

  async findPendingByAgent(agentId: string): Promise<Job[]> {
    const pool = getPool();
    const result = await pool.query<Job>(
      `SELECT
         id, type, status,
         map_id as "mapId",
         component_id as "componentId",
         agent_id as "agentId",
         command, args, result,
         created_at as "createdAt",
         started_at as "startedAt",
         completed_at as "completedAt",
         created_by as "createdBy"
       FROM jobs
       WHERE agent_id = $1 AND status IN ('pending', 'running')
       ORDER BY created_at ASC`,
      [agentId]
    );
    return result.rows;
  },

  async findByComponent(componentId: string, limit = 10): Promise<Job[]> {
    const pool = getPool();
    const result = await pool.query<Job>(
      `SELECT
         id, type, status,
         map_id as "mapId",
         component_id as "componentId",
         agent_id as "agentId",
         command, args, result,
         created_at as "createdAt",
         started_at as "startedAt",
         completed_at as "completedAt",
         created_by as "createdBy"
       FROM jobs
       WHERE component_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [componentId, limit]
    );
    return result.rows;
  },

  async cleanupOldJobs(olderThanDays = 30): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM jobs
       WHERE created_at < NOW() - INTERVAL '${olderThanDays} days'
       AND status IN ('completed', 'failed', 'timeout')`,
      []
    );
    return result.rowCount || 0;
  },
};
