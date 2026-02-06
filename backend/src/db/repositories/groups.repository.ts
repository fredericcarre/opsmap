import { getPool } from '../connection.js';
import { Group, GroupMember } from '../../types/index.js';

export interface CreateGroupParams {
  organizationId: string;
  name: string;
  description?: string;
}

export const groupsRepository = {
  async create(params: CreateGroupParams): Promise<Group> {
    const pool = getPool();
    const result = await pool.query<Group>(
      `INSERT INTO groups (organization_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING
         id,
         organization_id as "organizationId",
         name, description,
         created_at as "createdAt"`,
      [params.organizationId, params.name, params.description || null]
    );
    return result.rows[0];
  },

  async findById(id: string): Promise<Group | null> {
    const pool = getPool();
    const result = await pool.query<Group>(
      `SELECT
         id,
         organization_id as "organizationId",
         name, description,
         created_at as "createdAt"
       FROM groups WHERE id = $1`,
      [id]
    );
    return result.rows[0] || null;
  },

  async findByOrganization(organizationId: string): Promise<Group[]> {
    const pool = getPool();
    const result = await pool.query<Group>(
      `SELECT
         id,
         organization_id as "organizationId",
         name, description,
         created_at as "createdAt"
       FROM groups
       WHERE organization_id = $1
       ORDER BY name`,
      [organizationId]
    );
    return result.rows;
  },

  async update(id: string, params: { name?: string; description?: string }): Promise<Group | null> {
    const pool = getPool();
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (params.name !== undefined) {
      updates.push(`name = $${idx++}`);
      values.push(params.name);
    }
    if (params.description !== undefined) {
      updates.push(`description = $${idx++}`);
      values.push(params.description);
    }

    if (updates.length === 0) return this.findById(id);

    values.push(id);
    const result = await pool.query<Group>(
      `UPDATE groups SET ${updates.join(', ')}
       WHERE id = $${idx}
       RETURNING
         id,
         organization_id as "organizationId",
         name, description,
         created_at as "createdAt"`,
      values
    );
    return result.rows[0] || null;
  },

  async delete(id: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query('DELETE FROM groups WHERE id = $1', [id]);
    return (result.rowCount ?? 0) > 0;
  },

  // Group members
  async addMember(groupId: string, userId: string): Promise<GroupMember> {
    const pool = getPool();
    const result = await pool.query<GroupMember>(
      `INSERT INTO group_members (group_id, user_id)
       VALUES ($1, $2)
       ON CONFLICT (group_id, user_id) DO NOTHING
       RETURNING
         id,
         group_id as "groupId",
         user_id as "userId",
         added_at as "addedAt"`,
      [groupId, userId]
    );
    return result.rows[0];
  },

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const pool = getPool();
    const result = await pool.query(
      'DELETE FROM group_members WHERE group_id = $1 AND user_id = $2',
      [groupId, userId]
    );
    return (result.rowCount ?? 0) > 0;
  },

  async getMembers(groupId: string): Promise<Array<{ id: string; userId: string; email: string; name: string | null; addedAt: Date }>> {
    const pool = getPool();
    const result = await pool.query<{ id: string; userId: string; email: string; name: string | null; addedAt: Date }>(
      `SELECT
         gm.id,
         gm.user_id as "userId",
         u.email, u.name,
         gm.added_at as "addedAt"
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = $1
       ORDER BY u.name, u.email`,
      [groupId]
    );
    return result.rows;
  },

  async getMemberCount(groupId: string): Promise<number> {
    const pool = getPool();
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*) FROM group_members WHERE group_id = $1',
      [groupId]
    );
    return parseInt(result.rows[0].count, 10);
  },

  async getUserGroups(userId: string, organizationId: string): Promise<Group[]> {
    const pool = getPool();
    const result = await pool.query<Group>(
      `SELECT
         g.id,
         g.organization_id as "organizationId",
         g.name, g.description,
         g.created_at as "createdAt"
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id
       WHERE gm.user_id = $1 AND g.organization_id = $2
       ORDER BY g.name`,
      [userId, organizationId]
    );
    return result.rows;
  },
};
