# OpsMap Quickstart Guide

Get OpsMap running locally in under 5 minutes.

## Prerequisites

- Docker and Docker Compose
- Node.js 20+ (for development)
- Rust 1.75+ (for agent/gateway development)

## Quick Start with Docker Compose

### 1. Clone and Start

```bash
git clone https://github.com/your-org/opsmap.git
cd opsmap

# Start all services
docker-compose -f deploy/docker/docker-compose.dev.yaml up -d
```

### 2. Access the Application

| Service | URL | Credentials |
|---------|-----|-------------|
| Frontend | http://localhost:5173 | demo@opsmap.io / demo1234 |
| Backend API | http://localhost:3000 | - |
| PostgreSQL | localhost:5432 | opsmap / opsmap_dev |
| Redis | localhost:6379 | - |

### 3. Login and Explore

1. Open http://localhost:5173
2. Login with `demo@opsmap.io` / `demo1234`
3. You'll see the Dashboard with sample maps
4. Click on a map to view the dependency graph

## Manual Setup (Development)

### 1. Generate Certificates (mTLS)

```bash
# Generate PKI hierarchy
./scripts/pki/generate-certs.sh ./certs opsmap.local

# Output structure:
# certs/
# ├── root-ca/    # Keep offline in production!
# ├── backend/
# ├── gateway/
# ├── agent/
# └── ca-bundle.crt
```

### 2. Start Backend

```bash
cd backend

# Install dependencies
npm install

# Configure environment
cat > .env << 'EOF'
DATABASE_URL=postgresql://opsmap:opsmap_dev@localhost:5432/opsmap
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-production
JWT_REFRESH_SECRET=dev-refresh-secret-change-in-production
PORT=3000
EOF

# Run migrations
npm run db:migrate

# Seed demo data
npm run db:seed

# Start server
npm run dev
```

### 3. Start Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

### 4. Start Gateway (Rust)

```bash
cd gateway

# Create config
mkdir -p config
cat > config/gateway.dev.yaml << 'EOF'
gateway:
  id: gateway-local
  zone: development
  listen_addr: 0.0.0.0
  listen_port: 8443

backend:
  url: ws://localhost:3000/gateway
  reconnect_interval_secs: 5

tls:
  enabled: false
EOF

# Build and run
cargo run -- --config config/gateway.dev.yaml
```

### 5. Start Agent (Rust)

```bash
cd agent

# Create config
mkdir -p config
cat > config/agent.dev.yaml << 'EOF'
agent:
  id: agent-local

gateway:
  url: ws://localhost:8443/ws
  reconnect_interval_secs: 10

tls:
  enabled: false

labels:
  env: development
  role: test
EOF

# Build and run
cargo run -- --config config/agent.dev.yaml
```

## Creating Your First Map

### Via API

```bash
# Login and get token
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@opsmap.io","password":"demo1234"}' \
  | jq -r '.accessToken')

# Create a map
curl -X POST http://localhost:3000/api/v1/maps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My First Map",
    "description": "A simple application map",
    "yaml_content": "version: \"1.0\"\nname: my-app\ncomponents:\n  - id: web\n    name: Web Server\n    type: service"
  }'
```

### Via Frontend

1. Login at http://localhost:5173
2. Click "New Map" button
3. Fill in name and description
4. Add components via the YAML editor

## Map YAML Structure

```yaml
version: "1.0"
name: my-application
description: My application topology

components:
  - id: frontend
    name: Frontend
    type: service
    host: web-server.local
    checks:
      - type: http
        url: http://localhost:8080/health
        interval: 30s
    actions:
      start:
        command: systemctl start nginx
      stop:
        command: systemctl stop nginx
    dependencies:
      - backend

  - id: backend
    name: Backend API
    type: service
    host: api-server.local
    checks:
      - type: tcp_port
        port: 3000
        interval: 30s
    dependencies:
      - database

  - id: database
    name: PostgreSQL
    type: database
    host: db-server.local
    checks:
      - type: tcp_port
        port: 5432
        interval: 60s
```

## Component Types

| Type | Description | Common Checks |
|------|-------------|---------------|
| `service` | Application service | http, tcp_port, process |
| `database` | Database server | tcp_port, process |
| `queue` | Message queue | tcp_port, http |
| `cache` | Cache server | tcp_port |
| `gateway` | API Gateway/LB | http, tcp_port |
| `storage` | Storage system | disk_space |

## Available Checks

| Check | Description | Parameters |
|-------|-------------|------------|
| `http` | HTTP endpoint check | url, method, expected_status |
| `tcp_port` | TCP port open | port, host |
| `process` | Process running | name |
| `disk_space` | Disk usage | path, threshold |
| `memory` | Memory usage | threshold |
| `cpu` | CPU usage | threshold |
| `load_average` | System load | threshold |

## Permissions Model

OpsMap uses a granular RBAC model:

| Role | View | Execute | Edit | Admin |
|------|------|---------|------|-------|
| Viewer | Yes | No | No | No |
| Operator | Yes | Yes | No | No |
| Editor | Yes | Yes | Yes | No |
| Admin | Yes | Yes | Yes | Yes |

### Share a Map

```bash
# Grant user access
curl -X POST "http://localhost:3000/api/v1/maps/{mapId}/permissions/users" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-uuid", "role": "operator"}'

# Create share link (read-only)
curl -X POST "http://localhost:3000/api/v1/maps/{mapId}/share-links" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"expiresInDays": 7}'
```

## WebSocket Real-time Updates

```javascript
// Connect to WebSocket
const ws = new WebSocket('ws://localhost:3000/ws?token=YOUR_JWT');

// Subscribe to map updates
ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: { mapId: 'map-uuid' }
  }));
};

// Receive real-time updates
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log('Update:', msg);
  // msg.type: 'map_update', 'component_status', etc.
};
```

## Docker Commands

```bash
# Start all services
docker-compose -f deploy/docker/docker-compose.dev.yaml up -d

# View logs
docker-compose -f deploy/docker/docker-compose.dev.yaml logs -f

# Stop all services
docker-compose -f deploy/docker/docker-compose.dev.yaml down

# Reset database (remove volumes)
docker-compose -f deploy/docker/docker-compose.dev.yaml down -v
```

## Testing

```bash
# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test

# E2E tests
cd frontend && npm run test:e2e

# Agent tests
cd agent && cargo test

# Gateway tests
cd gateway && cargo test
```

## Troubleshooting

### Backend won't start

1. Check PostgreSQL is running:
   ```bash
   docker ps | grep postgres
   ```

2. Check migrations:
   ```bash
   cd backend && npm run db:migrate
   ```

### Agent can't connect to Gateway

1. Verify Gateway is running:
   ```bash
   curl http://localhost:8443/health
   ```

2. Check TLS configuration matches between agent and gateway

### Frontend shows "Unauthorized"

1. Token may have expired - login again
2. Check backend logs for auth errors:
   ```bash
   docker-compose logs backend
   ```

## Next Steps

1. Read the [Trading Platform Use Case](./use-case-trading-platform.md) for a real-world example
2. Review the [Full Specification](./opsmap-specification-v3.md) for detailed architecture
3. Set up [Kubernetes deployment](../deploy/kubernetes/) for production
4. Configure [mTLS](../scripts/pki/) for secure communication

## Support

- GitHub Issues: https://github.com/your-org/opsmap/issues
- Documentation: https://docs.opsmap.io
