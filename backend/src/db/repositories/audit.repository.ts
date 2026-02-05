import { query } from '../connection.js';
import type { AuditLog } from '../../types/index.js';

interface AuditLogRow {
  id: string;
  timestamp: Date;
  action: string;
  actor_type: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_ip: string | null;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  organization_id: string | null;
}

function rowToAuditLog(row: AuditLogRow): AuditLog {
  return {
    id: row.id,
    timestamp: row.timestamp,
    action: row.action,
    actorType: row.actor_type as 'user' | 'system' | 'agent',
    actorId: row.actor_id || '',
    actorEmail: row.actor_email,
    actorIp: row.actor_ip,
    targetType: row.target_type as AuditLog['targetType'],
    targetId: row.target_id || '',
    details: row.details,
    organizationId: row.organization_id || '',
  };
}

export interface CreateAuditLogInput {
  action: string;
  actorType: 'user' | 'system' | 'agent';
  actorId?: string;
  actorEmail?: string;
  actorIp?: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
  organizationId?: string;
}

export async function create(input: CreateAuditLogInput): Promise<AuditLog> {
  const result = await query<AuditLogRow>(
    `INSERT INTO audit_logs
       (action, actor_type, actor_id, actor_email, actor_ip, target_type, target_id, details, organization_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.action,
      input.actorType,
      input.actorId || null,
      input.actorEmail || null,
      input.actorIp || null,
      input.targetType,
      input.targetId || null,
      JSON.stringify(input.details || {}),
      input.organizationId || null,
    ]
  );
  return rowToAuditLog(result.rows[0]);
}

export interface AuditLogFilter {
  organizationId?: string;
  actorId?: string;
  targetType?: string;
  targetId?: string;
  action?: string;
  startDate?: Date;
  endDate?: Date;
  page?: number;
  pageSize?: number;
}

export async function find(
  filter: AuditLogFilter
): Promise<{ logs: AuditLog[]; total: number }> {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (filter.organizationId) {
    conditions.push(`organization_id = $${paramIndex++}`);
    params.push(filter.organizationId);
  }
  if (filter.actorId) {
    conditions.push(`actor_id = $${paramIndex++}`);
    params.push(filter.actorId);
  }
  if (filter.targetType) {
    conditions.push(`target_type = $${paramIndex++}`);
    params.push(filter.targetType);
  }
  if (filter.targetId) {
    conditions.push(`target_id = $${paramIndex++}`);
    params.push(filter.targetId);
  }
  if (filter.action) {
    conditions.push(`action ILIKE $${paramIndex++}`);
    params.push(`%${filter.action}%`);
  }
  if (filter.startDate) {
    conditions.push(`timestamp >= $${paramIndex++}`);
    params.push(filter.startDate);
  }
  if (filter.endDate) {
    conditions.push(`timestamp <= $${paramIndex++}`);
    params.push(filter.endDate);
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM audit_logs ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const offset = (page - 1) * pageSize;

  params.push(pageSize, offset);

  const result = await query<AuditLogRow>(
    `SELECT * FROM audit_logs ${whereClause}
     ORDER BY timestamp DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    params
  );

  return {
    logs: result.rows.map(rowToAuditLog),
    total,
  };
}

export async function findRecent(
  organizationId: string,
  limit: number = 100
): Promise<AuditLog[]> {
  const result = await query<AuditLogRow>(
    `SELECT * FROM audit_logs
     WHERE organization_id = $1
     ORDER BY timestamp DESC
     LIMIT $2`,
    [organizationId, limit]
  );
  return result.rows.map(rowToAuditLog);
}

export async function findByTarget(
  targetType: string,
  targetId: string,
  limit: number = 50
): Promise<AuditLog[]> {
  const result = await query<AuditLogRow>(
    `SELECT * FROM audit_logs
     WHERE target_type = $1 AND target_id = $2
     ORDER BY timestamp DESC
     LIMIT $3`,
    [targetType, targetId, limit]
  );
  return result.rows.map(rowToAuditLog);
}
