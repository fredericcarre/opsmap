import { pool, query } from './connection.js';
import { createChildLogger } from '../config/logger.js';
import bcrypt from 'bcrypt';

const logger = createChildLogger('seed');

async function seed(): Promise<void> {
  logger.info('Starting database seed...');

  try {
    // Create demo user
    const passwordHash = await bcrypt.hash('demo1234', 12);

    const userResult = await query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, auth_provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['demo@opsmap.io', 'Demo User', passwordHash, 'local']
    );
    const userId = userResult.rows[0].id;
    logger.info({ userId }, 'Demo user created');

    // Create demo organization
    const orgResult = await query<{ id: string }>(
      `INSERT INTO organizations (name, slug)
       VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['Demo Organization', 'demo-org']
    );
    const orgId = orgResult.rows[0].id;
    logger.info({ orgId }, 'Demo organization created');

    // Add user as owner
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [orgId, userId, 'owner']
    );

    // Create demo workspace
    const workspaceResult = await query<{ id: string }>(
      `INSERT INTO workspaces (organization_id, name, slug, description)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, slug) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [orgId, 'Production', 'production', 'Production environment']
    );
    const workspaceId = workspaceResult.rows[0].id;
    logger.info({ workspaceId }, 'Demo workspace created');

    // Create demo map
    const mapYaml = `
name: trading-platform
version: "1.0"
description: Trading Platform Application Stack

components:
  - id: nginx
    name: Nginx Load Balancer
    type: service
    agent:
      labels:
        role: proxy
    checks:
      - name: http_check
        type: http
        config:
          url: http://localhost:80/health
        interval: 30s
        timeout: 10s
    actions:
      - name: start
        command: systemctl start nginx
      - name: stop
        command: systemctl stop nginx
      - name: restart
        command: systemctl restart nginx

  - id: api-server
    name: API Server
    type: service
    dependencies:
      - postgresql
      - redis
    agent:
      labels:
        role: app
    checks:
      - name: http_check
        type: http
        config:
          url: http://localhost:3000/health
        interval: 30s
        timeout: 10s
    actions:
      - name: start
        command: systemctl start trading-api
      - name: stop
        command: systemctl stop trading-api
      - name: restart
        command: systemctl restart trading-api

  - id: postgresql
    name: PostgreSQL Database
    type: database
    agent:
      labels:
        role: database
    checks:
      - name: tcp_check
        type: tcp
        config:
          port: 5432
        interval: 30s
        timeout: 5s
    actions:
      - name: start
        command: systemctl start postgresql
      - name: stop
        command: systemctl stop postgresql
        confirmationRequired: true

  - id: redis
    name: Redis Cache
    type: cache
    agent:
      labels:
        role: cache
    checks:
      - name: tcp_check
        type: tcp
        config:
          port: 6379
        interval: 30s
        timeout: 5s
    actions:
      - name: start
        command: systemctl start redis
      - name: stop
        command: systemctl stop redis
`;

    const mapResult = await query<{ id: string }>(
      `INSERT INTO maps (workspace_id, name, slug, description, owner_id, yaml)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, slug) DO UPDATE SET yaml = EXCLUDED.yaml
       RETURNING id`,
      [workspaceId, 'Trading Platform', 'trading-platform', 'Main trading platform stack', userId, mapYaml]
    );
    const mapId = mapResult.rows[0].id;
    logger.info({ mapId }, 'Demo map created');

    // Create components
    const components = [
      { externalId: 'nginx', name: 'Nginx Load Balancer', type: 'service', position: { x: 300, y: 50 } },
      { externalId: 'api-server', name: 'API Server', type: 'service', position: { x: 300, y: 200 } },
      { externalId: 'postgresql', name: 'PostgreSQL Database', type: 'database', position: { x: 150, y: 350 } },
      { externalId: 'redis', name: 'Redis Cache', type: 'cache', position: { x: 450, y: 350 } },
    ];

    for (const comp of components) {
      await query(
        `INSERT INTO components (map_id, external_id, name, type, position, config)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (map_id, external_id) DO UPDATE SET
           name = EXCLUDED.name,
           position = EXCLUDED.position`,
        [mapId, comp.externalId, comp.name, comp.type, JSON.stringify(comp.position), '{}']
      );
    }
    logger.info({ count: components.length }, 'Demo components created');

    // Create second demo user
    const user2PasswordHash = await bcrypt.hash('operator123', 12);
    const user2Result = await query<{ id: string }>(
      `INSERT INTO users (email, name, password_hash, auth_provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      ['operator@opsmap.io', 'Operator User', user2PasswordHash, 'local']
    );
    const user2Id = user2Result.rows[0].id;

    // Add operator to org
    await query(
      `INSERT INTO organization_members (organization_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (organization_id, user_id) DO NOTHING`,
      [orgId, user2Id, 'member']
    );

    // Grant operator role on map
    const operatorRole = await query<{ id: string }>(
      `SELECT id FROM roles WHERE name = 'operator'`
    );
    if (operatorRole.rows[0]) {
      await query(
        `INSERT INTO map_permissions_users (map_id, user_id, role_id, granted_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (map_id, user_id) DO NOTHING`,
        [mapId, user2Id, operatorRole.rows[0].id, userId]
      );
    }

    logger.info('Database seed completed successfully');
    logger.info('');
    logger.info('Demo credentials:');
    logger.info('  Admin: demo@opsmap.io / demo1234');
    logger.info('  Operator: operator@opsmap.io / operator123');

  } catch (error) {
    logger.error({ error }, 'Seed failed');
    throw error;
  }
}

seed()
  .then(() => pool.end())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
