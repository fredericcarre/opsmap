import { query } from '../connection.js';
import type { User } from '../../types/index.js';
import bcrypt from 'bcrypt';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  password_hash: string | null;
  avatar_url: string | null;
  auth_provider: string;
  auth_provider_id: string | null;
  created_at: Date;
  last_login_at: Date | null;
}

function rowToUser(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    authProvider: row.auth_provider as 'local' | 'oidc' | 'saml',
    authProviderId: row.auth_provider_id,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  };
}

export async function findById(id: string): Promise<User | null> {
  const result = await query<UserRow>(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToUser(result.rows[0]) : null;
}

export async function findByEmail(email: string): Promise<User | null> {
  const result = await query<UserRow>(
    'SELECT * FROM users WHERE email = $1',
    [email]
  );
  return result.rows[0] ? rowToUser(result.rows[0]) : null;
}

export async function findByAuthProvider(
  provider: string,
  providerId: string
): Promise<User | null> {
  const result = await query<UserRow>(
    'SELECT * FROM users WHERE auth_provider = $1 AND auth_provider_id = $2',
    [provider, providerId]
  );
  return result.rows[0] ? rowToUser(result.rows[0]) : null;
}

export interface CreateUserInput {
  email: string;
  name?: string;
  password?: string;
  avatarUrl?: string;
  authProvider?: 'local' | 'oidc' | 'saml';
  authProviderId?: string;
}

export async function create(input: CreateUserInput): Promise<User> {
  const passwordHash = input.password
    ? await bcrypt.hash(input.password, 12)
    : null;

  const result = await query<UserRow>(
    `INSERT INTO users (email, name, password_hash, avatar_url, auth_provider, auth_provider_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.email,
      input.name || null,
      passwordHash,
      input.avatarUrl || null,
      input.authProvider || 'local',
      input.authProviderId || null,
    ]
  );

  return rowToUser(result.rows[0]);
}

export async function verifyPassword(
  email: string,
  password: string
): Promise<User | null> {
  const result = await query<UserRow>(
    'SELECT * FROM users WHERE email = $1 AND auth_provider = $2',
    [email, 'local']
  );

  const row = result.rows[0];
  if (!row || !row.password_hash) {
    return null;
  }

  const valid = await bcrypt.compare(password, row.password_hash);
  if (!valid) {
    return null;
  }

  return rowToUser(row);
}

export async function updateLastLogin(id: string): Promise<void> {
  await query(
    'UPDATE users SET last_login_at = NOW() WHERE id = $1',
    [id]
  );
}

export interface UpdateUserInput {
  name?: string;
  avatarUrl?: string;
}

export async function update(id: string, input: UpdateUserInput): Promise<User | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.avatarUrl !== undefined) {
    fields.push(`avatar_url = $${paramIndex++}`);
    values.push(input.avatarUrl);
  }

  if (fields.length === 0) {
    return findById(id);
  }

  values.push(id);

  const result = await query<UserRow>(
    `UPDATE users SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] ? rowToUser(result.rows[0]) : null;
}

export async function updatePassword(id: string, newPassword: string): Promise<void> {
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await query(
    'UPDATE users SET password_hash = $1 WHERE id = $2',
    [passwordHash, id]
  );
}

export async function deleteUser(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM users WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function list(options: {
  page?: number;
  pageSize?: number;
  search?: string;
}): Promise<{ users: User[]; total: number }> {
  const page = options.page || 1;
  const pageSize = options.pageSize || 20;
  const offset = (page - 1) * pageSize;

  let whereClause = '';
  const params: unknown[] = [];

  if (options.search) {
    whereClause = 'WHERE email ILIKE $1 OR name ILIKE $1';
    params.push(`%${options.search}%`);
  }

  const countResult = await query<{ count: string }>(
    `SELECT COUNT(*) FROM users ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].count, 10);

  params.push(pageSize, offset);
  const result = await query<UserRow>(
    `SELECT * FROM users ${whereClause}
     ORDER BY created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return {
    users: result.rows.map(rowToUser),
    total,
  };
}
