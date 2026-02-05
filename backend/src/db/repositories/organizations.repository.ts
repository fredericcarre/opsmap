import { query, transaction } from '../connection.js';
import type { Organization, OrganizationMember } from '../../types/index.js';

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  created_at: Date;
  settings: Record<string, unknown>;
}

interface OrgMemberRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  joined_at: Date;
}

function rowToOrg(row: OrganizationRow): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.created_at,
    settings: row.settings,
  };
}

function rowToMember(row: OrgMemberRow): OrganizationMember {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role as 'owner' | 'admin' | 'member',
    joinedAt: row.joined_at,
  };
}

export async function findById(id: string): Promise<Organization | null> {
  const result = await query<OrganizationRow>(
    'SELECT * FROM organizations WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToOrg(result.rows[0]) : null;
}

export async function findBySlug(slug: string): Promise<Organization | null> {
  const result = await query<OrganizationRow>(
    'SELECT * FROM organizations WHERE slug = $1',
    [slug]
  );
  return result.rows[0] ? rowToOrg(result.rows[0]) : null;
}

export interface CreateOrgInput {
  name: string;
  slug: string;
  settings?: Record<string, unknown>;
}

export async function create(
  input: CreateOrgInput,
  ownerId: string
): Promise<Organization> {
  return transaction(async (client) => {
    const orgResult = await client.query<OrganizationRow>(
      `INSERT INTO organizations (name, slug, settings)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [input.name, input.slug, JSON.stringify(input.settings || {})]
    );

    const org = rowToOrg(orgResult.rows[0]);

    // Add owner as member
    await client.query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, 'owner')`,
      [org.id, ownerId]
    );

    return org;
  });
}

export async function update(
  id: string,
  input: Partial<CreateOrgInput>
): Promise<Organization | null> {
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
  if (input.settings !== undefined) {
    fields.push(`settings = $${paramIndex++}`);
    values.push(JSON.stringify(input.settings));
  }

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await query<OrganizationRow>(
    `UPDATE organizations SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] ? rowToOrg(result.rows[0]) : null;
}

export async function deleteOrg(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM organizations WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

// Members

export async function findUserOrganizations(userId: string): Promise<Organization[]> {
  const result = await query<OrganizationRow>(
    `SELECT o.* FROM organizations o
     JOIN organization_members om ON o.id = om.organization_id
     WHERE om.user_id = $1
     ORDER BY o.name`,
    [userId]
  );
  return result.rows.map(rowToOrg);
}

export async function findMembers(orgId: string): Promise<OrganizationMember[]> {
  const result = await query<OrgMemberRow>(
    'SELECT * FROM organization_members WHERE organization_id = $1',
    [orgId]
  );
  return result.rows.map(rowToMember);
}

export async function findMembership(
  orgId: string,
  userId: string
): Promise<OrganizationMember | null> {
  const result = await query<OrgMemberRow>(
    'SELECT * FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return result.rows[0] ? rowToMember(result.rows[0]) : null;
}

export async function addMember(
  orgId: string,
  userId: string,
  role: 'admin' | 'member' = 'member'
): Promise<OrganizationMember> {
  const result = await query<OrgMemberRow>(
    `INSERT INTO organization_members (organization_id, user_id, role)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [orgId, userId, role]
  );
  return rowToMember(result.rows[0]);
}

export async function updateMemberRole(
  orgId: string,
  userId: string,
  role: 'owner' | 'admin' | 'member'
): Promise<OrganizationMember | null> {
  const result = await query<OrgMemberRow>(
    `UPDATE organization_members SET role = $3
     WHERE organization_id = $1 AND user_id = $2
     RETURNING *`,
    [orgId, userId, role]
  );
  return result.rows[0] ? rowToMember(result.rows[0]) : null;
}

export async function removeMember(orgId: string, userId: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM organization_members WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}
