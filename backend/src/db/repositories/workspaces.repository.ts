import { query } from '../connection.js';
import type { Workspace } from '../../types/index.js';

interface WorkspaceRow {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  description: string | null;
  created_at: Date;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    createdAt: row.created_at,
  };
}

export async function findById(id: string): Promise<Workspace | null> {
  const result = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToWorkspace(result.rows[0]) : null;
}

export async function findBySlug(
  orgId: string,
  slug: string
): Promise<Workspace | null> {
  const result = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE organization_id = $1 AND slug = $2',
    [orgId, slug]
  );
  return result.rows[0] ? rowToWorkspace(result.rows[0]) : null;
}

export async function findByOrganization(orgId: string): Promise<Workspace[]> {
  const result = await query<WorkspaceRow>(
    'SELECT * FROM workspaces WHERE organization_id = $1 ORDER BY name',
    [orgId]
  );
  return result.rows.map(rowToWorkspace);
}

export interface CreateWorkspaceInput {
  organizationId: string;
  name: string;
  slug: string;
  description?: string;
}

export async function create(input: CreateWorkspaceInput): Promise<Workspace> {
  const result = await query<WorkspaceRow>(
    `INSERT INTO workspaces (organization_id, name, slug, description)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [input.organizationId, input.name, input.slug, input.description || null]
  );
  return rowToWorkspace(result.rows[0]);
}

export interface UpdateWorkspaceInput {
  name?: string;
  slug?: string;
  description?: string;
}

export async function update(
  id: string,
  input: UpdateWorkspaceInput
): Promise<Workspace | null> {
  const fields: string[] = [];
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

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await query<WorkspaceRow>(
    `UPDATE workspaces SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] ? rowToWorkspace(result.rows[0]) : null;
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM workspaces WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}
