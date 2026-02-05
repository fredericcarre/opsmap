import { query } from '../connection.js';
import type { Map } from '../../types/index.js';

interface MapRow {
  id: string;
  workspace_id: string;
  name: string;
  slug: string;
  description: string | null;
  owner_id: string;
  git_repo_url: string | null;
  git_branch: string;
  yaml: string | null;
  created_at: Date;
  updated_at: Date;
}

function rowToMap(row: MapRow): Map {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    ownerId: row.owner_id,
    gitRepoUrl: row.git_repo_url,
    gitBranch: row.git_branch,
    yaml: row.yaml,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string): Promise<Map | null> {
  const result = await query<MapRow>(
    'SELECT * FROM maps WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToMap(result.rows[0]) : null;
}

export async function findBySlug(
  workspaceId: string,
  slug: string
): Promise<Map | null> {
  const result = await query<MapRow>(
    'SELECT * FROM maps WHERE workspace_id = $1 AND slug = $2',
    [workspaceId, slug]
  );
  return result.rows[0] ? rowToMap(result.rows[0]) : null;
}

export async function findAll(): Promise<Map[]> {
  const result = await query<MapRow>(
    'SELECT * FROM maps ORDER BY name'
  );
  return result.rows.map(rowToMap);
}

export async function findByWorkspace(workspaceId: string): Promise<Map[]> {
  const result = await query<MapRow>(
    'SELECT * FROM maps WHERE workspace_id = $1 ORDER BY name',
    [workspaceId]
  );
  return result.rows.map(rowToMap);
}

export async function findByOwner(ownerId: string): Promise<Map[]> {
  const result = await query<MapRow>(
    'SELECT * FROM maps WHERE owner_id = $1 ORDER BY updated_at DESC',
    [ownerId]
  );
  return result.rows.map(rowToMap);
}

export async function findAccessible(
  userId: string,
  workspaceId?: string
): Promise<Map[]> {
  let sql = `
    SELECT DISTINCT m.* FROM maps m
    LEFT JOIN map_permissions_users mpu ON m.id = mpu.map_id AND mpu.user_id = $1
    LEFT JOIN map_permissions_groups mpg ON m.id = mpg.map_id
    LEFT JOIN group_members gm ON mpg.group_id = gm.group_id AND gm.user_id = $1
    WHERE m.owner_id = $1
       OR mpu.user_id IS NOT NULL
       OR gm.user_id IS NOT NULL
  `;
  const params: unknown[] = [userId];

  if (workspaceId) {
    sql += ' AND m.workspace_id = $2';
    params.push(workspaceId);
  }

  sql += ' ORDER BY m.updated_at DESC';

  const result = await query<MapRow>(sql, params);
  return result.rows.map(rowToMap);
}

export interface CreateMapInput {
  workspaceId: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  gitRepoUrl?: string;
  gitBranch?: string;
  yaml?: string;
}

export async function create(input: CreateMapInput): Promise<Map> {
  const result = await query<MapRow>(
    `INSERT INTO maps (workspace_id, name, slug, description, owner_id, git_repo_url, git_branch, yaml)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.workspaceId,
      input.name,
      input.slug,
      input.description || null,
      input.ownerId,
      input.gitRepoUrl || null,
      input.gitBranch || 'main',
      input.yaml || null,
    ]
  );
  return rowToMap(result.rows[0]);
}

export interface UpdateMapInput {
  name?: string;
  slug?: string;
  description?: string;
  gitRepoUrl?: string;
  gitBranch?: string;
  yaml?: string;
}

export async function update(id: string, input: UpdateMapInput): Promise<Map | null> {
  const fields: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.slug !== undefined) {
    fields.push(`slug = $${paramIndex++}`);
    values.push(input.slug);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(input.description);
  }
  if (input.gitRepoUrl !== undefined) {
    fields.push(`git_repo_url = $${paramIndex++}`);
    values.push(input.gitRepoUrl);
  }
  if (input.gitBranch !== undefined) {
    fields.push(`git_branch = $${paramIndex++}`);
    values.push(input.gitBranch);
  }
  if (input.yaml !== undefined) {
    fields.push(`yaml = $${paramIndex++}`);
    values.push(input.yaml);
  }

  values.push(id);

  const result = await query<MapRow>(
    `UPDATE maps SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] ? rowToMap(result.rows[0]) : null;
}

export async function deleteMap(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM maps WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function transferOwnership(
  mapId: string,
  newOwnerId: string
): Promise<Map | null> {
  const result = await query<MapRow>(
    'UPDATE maps SET owner_id = $2, updated_at = NOW() WHERE id = $1 RETURNING *',
    [mapId, newOwnerId]
  );
  return result.rows[0] ? rowToMap(result.rows[0]) : null;
}
