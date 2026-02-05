import { query } from '../connection.js';
import type {
  Role,
  MapPermissionUser,
  MapPermissionGroup,
  MapShareLink,
  PermissionOverrides,
  RolePermissions,
} from '../../types/index.js';
import crypto from 'crypto';

// Role types
interface RoleRow {
  id: string;
  name: string;
  description: string | null;
  permissions: RolePermissions;
}

function rowToRole(row: RoleRow): Role {
  return {
    id: row.id,
    name: row.name as Role['name'],
    description: row.description,
    permissions: row.permissions,
  };
}

// Permission types
interface UserPermRow {
  id: string;
  map_id: string;
  user_id: string;
  role_id: string;
  permission_overrides: PermissionOverrides;
  granted_by: string;
  granted_at: Date;
  expires_at: Date | null;
}

interface GroupPermRow {
  id: string;
  map_id: string;
  group_id: string;
  role_id: string;
  permission_overrides: PermissionOverrides;
  granted_by: string;
  granted_at: Date;
}

interface ShareLinkRow {
  id: string;
  map_id: string;
  token: string;
  role_id: string;
  created_by: string;
  created_at: Date;
  expires_at: Date | null;
  password_hash: string | null;
  max_uses: number | null;
  use_count: number;
  is_active: boolean;
}

function rowToUserPerm(row: UserPermRow): MapPermissionUser {
  return {
    id: row.id,
    mapId: row.map_id,
    userId: row.user_id,
    roleId: row.role_id,
    permissionOverrides: row.permission_overrides,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
    expiresAt: row.expires_at,
  };
}

function rowToGroupPerm(row: GroupPermRow): MapPermissionGroup {
  return {
    id: row.id,
    mapId: row.map_id,
    groupId: row.group_id,
    roleId: row.role_id,
    permissionOverrides: row.permission_overrides,
    grantedBy: row.granted_by,
    grantedAt: row.granted_at,
  };
}

function rowToShareLink(row: ShareLinkRow): MapShareLink {
  return {
    id: row.id,
    mapId: row.map_id,
    token: row.token,
    roleId: row.role_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    passwordHash: row.password_hash,
    maxUses: row.max_uses,
    useCount: row.use_count,
    isActive: row.is_active,
  };
}

// Roles

export async function findRoleById(id: string): Promise<Role | null> {
  const result = await query<RoleRow>(
    'SELECT * FROM roles WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToRole(result.rows[0]) : null;
}

export async function findRoleByName(name: string): Promise<Role | null> {
  const result = await query<RoleRow>(
    'SELECT * FROM roles WHERE name = $1',
    [name]
  );
  return result.rows[0] ? rowToRole(result.rows[0]) : null;
}

export async function listRoles(): Promise<Role[]> {
  const result = await query<RoleRow>('SELECT * FROM roles ORDER BY name');
  return result.rows.map(rowToRole);
}

// User Permissions

export async function findUserPermission(
  mapId: string,
  userId: string
): Promise<MapPermissionUser | null> {
  const result = await query<UserPermRow>(
    `SELECT * FROM map_permissions_users
     WHERE map_id = $1 AND user_id = $2
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [mapId, userId]
  );
  return result.rows[0] ? rowToUserPerm(result.rows[0]) : null;
}

export async function findMapUserPermissions(mapId: string): Promise<MapPermissionUser[]> {
  const result = await query<UserPermRow>(
    'SELECT * FROM map_permissions_users WHERE map_id = $1',
    [mapId]
  );
  return result.rows.map(rowToUserPerm);
}

export interface GrantUserPermissionInput {
  mapId: string;
  userId: string;
  roleId: string;
  grantedBy: string;
  permissionOverrides?: PermissionOverrides;
  expiresAt?: Date;
}

export async function grantUserPermission(
  input: GrantUserPermissionInput
): Promise<MapPermissionUser> {
  const result = await query<UserPermRow>(
    `INSERT INTO map_permissions_users
       (map_id, user_id, role_id, granted_by, permission_overrides, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (map_id, user_id)
     DO UPDATE SET
       role_id = EXCLUDED.role_id,
       permission_overrides = EXCLUDED.permission_overrides,
       expires_at = EXCLUDED.expires_at,
       granted_at = NOW()
     RETURNING *`,
    [
      input.mapId,
      input.userId,
      input.roleId,
      input.grantedBy,
      JSON.stringify(input.permissionOverrides || {}),
      input.expiresAt || null,
    ]
  );
  return rowToUserPerm(result.rows[0]);
}

export async function updateUserPermission(
  mapId: string,
  userId: string,
  input: { roleId?: string; permissionOverrides?: PermissionOverrides; expiresAt?: Date | null }
): Promise<MapPermissionUser | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.roleId !== undefined) {
    fields.push(`role_id = $${paramIndex++}`);
    values.push(input.roleId);
  }
  if (input.permissionOverrides !== undefined) {
    fields.push(`permission_overrides = $${paramIndex++}`);
    values.push(JSON.stringify(input.permissionOverrides));
  }
  if (input.expiresAt !== undefined) {
    fields.push(`expires_at = $${paramIndex++}`);
    values.push(input.expiresAt);
  }

  if (fields.length === 0) {
    return findUserPermission(mapId, userId);
  }

  values.push(mapId, userId);

  const result = await query<UserPermRow>(
    `UPDATE map_permissions_users SET ${fields.join(', ')}
     WHERE map_id = $${paramIndex} AND user_id = $${paramIndex + 1}
     RETURNING *`,
    values
  );

  return result.rows[0] ? rowToUserPerm(result.rows[0]) : null;
}

export async function revokeUserPermission(
  mapId: string,
  userId: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM map_permissions_users WHERE map_id = $1 AND user_id = $2',
    [mapId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Group Permissions

export async function findGroupPermission(
  mapId: string,
  groupId: string
): Promise<MapPermissionGroup | null> {
  const result = await query<GroupPermRow>(
    'SELECT * FROM map_permissions_groups WHERE map_id = $1 AND group_id = $2',
    [mapId, groupId]
  );
  return result.rows[0] ? rowToGroupPerm(result.rows[0]) : null;
}

export async function findMapGroupPermissions(mapId: string): Promise<MapPermissionGroup[]> {
  const result = await query<GroupPermRow>(
    'SELECT * FROM map_permissions_groups WHERE map_id = $1',
    [mapId]
  );
  return result.rows.map(rowToGroupPerm);
}

export async function findUserGroupPermissions(
  mapId: string,
  userId: string
): Promise<MapPermissionGroup[]> {
  const result = await query<GroupPermRow>(
    `SELECT mpg.* FROM map_permissions_groups mpg
     JOIN group_members gm ON mpg.group_id = gm.group_id
     WHERE mpg.map_id = $1 AND gm.user_id = $2`,
    [mapId, userId]
  );
  return result.rows.map(rowToGroupPerm);
}

export interface GrantGroupPermissionInput {
  mapId: string;
  groupId: string;
  roleId: string;
  grantedBy: string;
  permissionOverrides?: PermissionOverrides;
}

export async function grantGroupPermission(
  input: GrantGroupPermissionInput
): Promise<MapPermissionGroup> {
  const result = await query<GroupPermRow>(
    `INSERT INTO map_permissions_groups
       (map_id, group_id, role_id, granted_by, permission_overrides)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (map_id, group_id)
     DO UPDATE SET
       role_id = EXCLUDED.role_id,
       permission_overrides = EXCLUDED.permission_overrides,
       granted_at = NOW()
     RETURNING *`,
    [
      input.mapId,
      input.groupId,
      input.roleId,
      input.grantedBy,
      JSON.stringify(input.permissionOverrides || {}),
    ]
  );
  return rowToGroupPerm(result.rows[0]);
}

export async function revokeGroupPermission(
  mapId: string,
  groupId: string
): Promise<boolean> {
  const result = await query(
    'DELETE FROM map_permissions_groups WHERE map_id = $1 AND group_id = $2',
    [mapId, groupId]
  );
  return (result.rowCount ?? 0) > 0;
}

// Share Links

export async function findShareLink(token: string): Promise<MapShareLink | null> {
  const result = await query<ShareLinkRow>(
    `SELECT * FROM map_share_links
     WHERE token = $1
       AND is_active = true
       AND (expires_at IS NULL OR expires_at > NOW())
       AND (max_uses IS NULL OR use_count < max_uses)`,
    [token]
  );
  return result.rows[0] ? rowToShareLink(result.rows[0]) : null;
}

export async function findMapShareLinks(mapId: string): Promise<MapShareLink[]> {
  const result = await query<ShareLinkRow>(
    'SELECT * FROM map_share_links WHERE map_id = $1 ORDER BY created_at DESC',
    [mapId]
  );
  return result.rows.map(rowToShareLink);
}

export interface CreateShareLinkInput {
  mapId: string;
  roleId: string;
  createdBy: string;
  expiresAt?: Date;
  maxUses?: number;
  passwordHash?: string;
}

export async function createShareLink(
  input: CreateShareLinkInput
): Promise<MapShareLink> {
  const token = crypto.randomBytes(32).toString('hex');

  const result = await query<ShareLinkRow>(
    `INSERT INTO map_share_links
       (map_id, token, role_id, created_by, expires_at, max_uses, password_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.mapId,
      token,
      input.roleId,
      input.createdBy,
      input.expiresAt || null,
      input.maxUses || null,
      input.passwordHash || null,
    ]
  );
  return rowToShareLink(result.rows[0]);
}

export async function incrementShareLinkUse(token: string): Promise<void> {
  await query(
    'UPDATE map_share_links SET use_count = use_count + 1 WHERE token = $1',
    [token]
  );
}

export async function deactivateShareLink(id: string): Promise<boolean> {
  const result = await query(
    'UPDATE map_share_links SET is_active = false WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteShareLink(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM map_share_links WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

// Permission Check Helper

export async function checkPermission(
  userId: string,
  mapId: string,
  permission: string,
  componentId?: string
): Promise<{ allowed: boolean; reason: string }> {
  // 1. Check if user is owner
  const ownerCheck = await query<{ owner_id: string }>(
    'SELECT owner_id FROM maps WHERE id = $1',
    [mapId]
  );

  if (ownerCheck.rows[0]?.owner_id === userId) {
    return { allowed: true, reason: 'User is map owner' };
  }

  // 2. Check direct user permission
  const userPerm = await findUserPermission(mapId, userId);
  if (userPerm) {
    const role = await findRoleById(userPerm.roleId);
    if (role) {
      const allowed = checkPermissionInRole(
        role.permissions,
        userPerm.permissionOverrides,
        permission,
        componentId
      );
      if (allowed) {
        return { allowed: true, reason: `Role '${role.name}' grants this permission` };
      }
    }
  }

  // 3. Check group permissions
  const groupPerms = await findUserGroupPermissions(mapId, userId);
  for (const groupPerm of groupPerms) {
    const role = await findRoleById(groupPerm.roleId);
    if (role) {
      const allowed = checkPermissionInRole(
        role.permissions,
        groupPerm.permissionOverrides,
        permission,
        componentId
      );
      if (allowed) {
        return { allowed: true, reason: `Group permission grants this via role '${role.name}'` };
      }
    }
  }

  return { allowed: false, reason: 'No permission found' };
}

function checkPermissionInRole(
  rolePerms: RolePermissions,
  overrides: PermissionOverrides,
  permission: string,
  componentId?: string
): boolean {
  const [category, action] = permission.split(':');

  // Check for wildcard
  const perms = rolePerms[category as keyof RolePermissions] || [];
  if (perms.includes('*') || perms.includes(action)) {
    // Check overrides for deny
    if (componentId && overrides.components?.[componentId]?.deny?.includes(action)) {
      return false;
    }
    return true;
  }

  // Check overrides for explicit allow
  if (componentId && overrides.components?.[componentId]?.allow?.includes(action)) {
    return true;
  }

  return false;
}
