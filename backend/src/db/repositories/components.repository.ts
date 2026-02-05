import { query } from '../connection.js';
import type { Component, ComponentConfig } from '../../types/index.js';

interface ComponentRow {
  id: string;
  map_id: string;
  external_id: string;
  name: string;
  type: string;
  config: ComponentConfig;
  position: { x: number; y: number };
  created_at: Date;
  updated_at: Date;
}

function rowToComponent(row: ComponentRow): Component {
  return {
    id: row.id,
    mapId: row.map_id,
    name: row.name,
    type: row.type,
    config: row.config,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findById(id: string): Promise<Component | null> {
  const result = await query<ComponentRow>(
    'SELECT * FROM components WHERE id = $1',
    [id]
  );
  return result.rows[0] ? rowToComponent(result.rows[0]) : null;
}

export async function findByExternalId(
  mapId: string,
  externalId: string
): Promise<Component | null> {
  const result = await query<ComponentRow>(
    'SELECT * FROM components WHERE map_id = $1 AND external_id = $2',
    [mapId, externalId]
  );
  return result.rows[0] ? rowToComponent(result.rows[0]) : null;
}

export async function findByMap(mapId: string): Promise<Component[]> {
  const result = await query<ComponentRow>(
    'SELECT * FROM components WHERE map_id = $1 ORDER BY name',
    [mapId]
  );
  return result.rows.map(rowToComponent);
}

export interface CreateComponentInput {
  mapId: string;
  externalId: string;
  name: string;
  type: string;
  config?: ComponentConfig;
  position?: { x: number; y: number };
}

export async function create(input: CreateComponentInput): Promise<Component> {
  const result = await query<ComponentRow>(
    `INSERT INTO components (map_id, external_id, name, type, config, position)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.mapId,
      input.externalId,
      input.name,
      input.type,
      JSON.stringify(input.config || {}),
      JSON.stringify(input.position || { x: 0, y: 0 }),
    ]
  );
  return rowToComponent(result.rows[0]);
}

export interface UpdateComponentInput {
  name?: string;
  type?: string;
  config?: ComponentConfig;
  position?: { x: number; y: number };
}

export async function update(
  id: string,
  input: UpdateComponentInput
): Promise<Component | null> {
  const fields: string[] = ['updated_at = NOW()'];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(input.name);
  }
  if (input.type !== undefined) {
    fields.push(`type = $${paramIndex++}`);
    values.push(input.type);
  }
  if (input.config !== undefined) {
    fields.push(`config = $${paramIndex++}`);
    values.push(JSON.stringify(input.config));
  }
  if (input.position !== undefined) {
    fields.push(`position = $${paramIndex++}`);
    values.push(JSON.stringify(input.position));
  }

  values.push(id);

  const result = await query<ComponentRow>(
    `UPDATE components SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  return result.rows[0] ? rowToComponent(result.rows[0]) : null;
}

export async function deleteComponent(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM components WHERE id = $1',
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteByMap(mapId: string): Promise<number> {
  const result = await query(
    'DELETE FROM components WHERE map_id = $1',
    [mapId]
  );
  return result.rowCount ?? 0;
}

export async function upsertMany(
  mapId: string,
  components: CreateComponentInput[]
): Promise<Component[]> {
  const results: Component[] = [];

  for (const comp of components) {
    const existing = await findByExternalId(mapId, comp.externalId);
    if (existing) {
      const updated = await update(existing.id, {
        name: comp.name,
        type: comp.type,
        config: comp.config,
        position: comp.position,
      });
      if (updated) results.push(updated);
    } else {
      const created = await create(comp);
      results.push(created);
    }
  }

  return results;
}
