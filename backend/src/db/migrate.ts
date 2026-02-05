import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from './connection.js';
import { createChildLogger } from '../config/logger.js';

const logger = createChildLogger('migrate');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Migration {
  id: number;
  name: string;
  executed_at: Date;
}

async function ensureMigrationsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function getExecutedMigrations(): Promise<string[]> {
  const result = await query<Migration>('SELECT name FROM _migrations ORDER BY id');
  return result.rows.map((row) => row.name);
}

async function getMigrationFiles(): Promise<string[]> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  return files;
}

async function runMigration(filename: string): Promise<void> {
  const migrationsDir = path.join(__dirname, 'migrations');
  const filePath = path.join(migrationsDir, filename);
  const sql = fs.readFileSync(filePath, 'utf-8');

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO _migrations (name) VALUES ($1)',
      [filename]
    );
    await client.query('COMMIT');
    logger.info({ migration: filename }, 'Migration executed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error({ migration: filename, error }, 'Migration failed');
    throw error;
  } finally {
    client.release();
  }
}

async function migrate(): Promise<void> {
  logger.info('Starting database migrations...');

  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();
  const files = await getMigrationFiles();

  const pending = files.filter((f) => !executed.includes(f));

  if (pending.length === 0) {
    logger.info('No pending migrations');
    return;
  }

  logger.info({ count: pending.length }, 'Found pending migrations');

  for (const file of pending) {
    await runMigration(file);
  }

  logger.info('All migrations completed');
}

async function createMigration(name: string): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const filename = `${timestamp}_${name}.sql`;
  const migrationsDir = path.join(__dirname, 'migrations');
  const filePath = path.join(migrationsDir, filename);

  const template = `-- Migration: ${filename}
-- Description: ${name}

-- Write your migration SQL here
`;

  fs.writeFileSync(filePath, template);
  logger.info({ filename }, 'Created new migration file');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === 'create') {
    if (!args[1]) {
      console.error('Usage: npm run db:migrate:create <migration_name>');
      process.exit(1);
    }
    await createMigration(args[1]);
  } else {
    await migrate();
  }

  await pool.end();
}

main().catch((error) => {
  logger.error({ error }, 'Migration script failed');
  process.exit(1);
});
