import { getPool } from '../connection.js';

export interface CheckResult {
  id: string;
  componentId: string;
  checkName: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  message: string | null;
  metrics: Record<string, number> | null;
  durationMs: number | null;
  checkedAt: Date;
}

export interface CreateCheckResultParams {
  componentId: string;
  checkName: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  message?: string;
  metrics?: Record<string, number>;
  durationMs?: number;
}

export const checkResultsRepository = {
  async create(params: CreateCheckResultParams): Promise<CheckResult> {
    const pool = getPool();
    const result = await pool.query<CheckResult>(
      `INSERT INTO check_results (component_id, check_name, status, message, metrics, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING
         id,
         component_id as "componentId",
         check_name as "checkName",
         status, message, metrics,
         duration_ms as "durationMs",
         checked_at as "checkedAt"`,
      [
        params.componentId,
        params.checkName,
        params.status,
        params.message || null,
        params.metrics ? JSON.stringify(params.metrics) : null,
        params.durationMs || null,
      ]
    );
    return result.rows[0];
  },

  async createBatch(results: CreateCheckResultParams[]): Promise<number> {
    if (results.length === 0) return 0;
    const pool = getPool();

    const values: unknown[] = [];
    const placeholders: string[] = [];
    let idx = 1;

    for (const r of results) {
      placeholders.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
      values.push(
        r.componentId, r.checkName, r.status,
        r.message || null,
        r.metrics ? JSON.stringify(r.metrics) : null,
        r.durationMs || null,
      );
    }

    const result = await pool.query(
      `INSERT INTO check_results (component_id, check_name, status, message, metrics, duration_ms)
       VALUES ${placeholders.join(', ')}`,
      values
    );
    return result.rowCount || 0;
  },

  async findByComponent(componentId: string, limit = 100): Promise<CheckResult[]> {
    const pool = getPool();
    const result = await pool.query<CheckResult>(
      `SELECT
         id,
         component_id as "componentId",
         check_name as "checkName",
         status, message, metrics,
         duration_ms as "durationMs",
         checked_at as "checkedAt"
       FROM check_results
       WHERE component_id = $1
       ORDER BY checked_at DESC
       LIMIT $2`,
      [componentId, limit]
    );
    return result.rows;
  },

  async findByComponentAndCheck(componentId: string, checkName: string, limit = 50): Promise<CheckResult[]> {
    const pool = getPool();
    const result = await pool.query<CheckResult>(
      `SELECT
         id,
         component_id as "componentId",
         check_name as "checkName",
         status, message, metrics,
         duration_ms as "durationMs",
         checked_at as "checkedAt"
       FROM check_results
       WHERE component_id = $1 AND check_name = $2
       ORDER BY checked_at DESC
       LIMIT $3`,
      [componentId, checkName, limit]
    );
    return result.rows;
  },

  async getLatestByComponent(componentId: string): Promise<CheckResult[]> {
    const pool = getPool();
    const result = await pool.query<CheckResult>(
      `SELECT DISTINCT ON (check_name)
         id,
         component_id as "componentId",
         check_name as "checkName",
         status, message, metrics,
         duration_ms as "durationMs",
         checked_at as "checkedAt"
       FROM check_results
       WHERE component_id = $1
       ORDER BY check_name, checked_at DESC`,
      [componentId]
    );
    return result.rows;
  },

  async getComponentStatus(componentId: string): Promise<{ status: string; checks: CheckResult[] }> {
    const latest = await this.getLatestByComponent(componentId);
    // Overall status: worst status wins
    let status: string = 'unknown';
    if (latest.length > 0) {
      if (latest.some((c) => c.status === 'error')) status = 'error';
      else if (latest.some((c) => c.status === 'warning')) status = 'warning';
      else if (latest.every((c) => c.status === 'ok')) status = 'ok';
    }
    return { status, checks: latest };
  },

  async getMapStatus(mapId: string): Promise<Array<{ componentId: string; componentName: string; status: string; lastCheck: Date | null }>> {
    const pool = getPool();
    const result = await pool.query<{ componentId: string; componentName: string; status: string; lastCheck: Date | null }>(
      `SELECT
         c.id as "componentId",
         c.name as "componentName",
         COALESCE(
           (SELECT cr.status FROM check_results cr
            WHERE cr.component_id = c.id
            ORDER BY cr.checked_at DESC LIMIT 1),
           'unknown'
         ) as status,
         (SELECT cr.checked_at FROM check_results cr
          WHERE cr.component_id = c.id
          ORDER BY cr.checked_at DESC LIMIT 1) as "lastCheck"
       FROM components c
       WHERE c.map_id = $1
       ORDER BY c.name`,
      [mapId]
    );
    return result.rows;
  },

  async cleanup(olderThanDays = 90): Promise<number> {
    const pool = getPool();
    const result = await pool.query(
      `DELETE FROM check_results WHERE checked_at < NOW() - make_interval(days => $1)`,
      [olderThanDays]
    );
    return result.rowCount || 0;
  },
};
