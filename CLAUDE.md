# CLAUDE.md - OpsMap Project Context

## Project Overview

**OpsMap** is a lightweight AIOps tool for mapping, monitoring, and controlling enterprise applications.

**Tech Stack:**
- **Agent**: Rust (single binary, ~5MB, zero dependencies)
- **Gateway**: Rust (zones relay, mTLS)
- **Backend**: Node.js/TypeScript (API, MCP, FSM)
- **Frontend**: React + Vite + Tailwind + shadcn/ui
- **Database**: PostgreSQL + Redis
- **Auth**: OIDC/SAML (enterprise SSO)

**Key Principles:**
- HTTPS/WSS on port 443 only (firewall-friendly)
- Agent semi-autonomous (executes checks locally, sends deltas)
- Process detachment (double-fork, no handles)
- mTLS everywhere
- GitOps native (Maps versioned in Git)

## Repository Structure

```
opsmap/
├── CLAUDE.md                    # This file
├── docs/
│   └── opsmap-specification-v3.md  # Full specification
├── agent/                       # Rust agent
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── config/              # YAML config loader
│       ├── connection/          # WebSocket/HTTPS to Gateway
│       ├── executor/            # Process execution (detached)
│       ├── scheduler/           # Local check scheduler
│       ├── native_commands/     # Built-in commands
│       ├── discovery/           # Auto-discovery
│       └── buffer/              # Offline buffer
├── gateway/                     # Rust gateway
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs
│       ├── agent_server/        # Accept agent connections
│       ├── backend_client/      # Connect to backend
│       ├── registry/            # Agent registry
│       └── router/              # Command routing
├── backend/                     # Node.js/TypeScript backend
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── api/                 # REST API (Express)
│       ├── websocket/           # WebSocket server
│       ├── mcp/                 # MCP Server
│       ├── core/                # Business logic
│       │   ├── maps/            # Map management
│       │   ├── commands/        # Command orchestration
│       │   ├── permissions/     # RBAC
│       │   └── fsm/             # State machine (xcomponent-ai)
│       ├── gitops/              # Git sync
│       ├── db/                  # PostgreSQL + Redis
│       └── auth/                # OIDC/SAML
├── frontend/                    # React frontend
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx
│       ├── components/
│       ├── pages/
│       ├── hooks/
│       ├── api/
│       └── stores/
├── deploy/                      # Deployment configs
│   ├── docker/
│   ├── kubernetes/
│   └── helm/
└── scripts/                     # Utility scripts
    └── pki/                     # Certificate generation
```

## Critical Implementation Details

### 1. Agent Process Detachment (CRITICAL)

The agent MUST launch processes completely detached. A crash of the agent must NOT affect running processes.

```rust
// Use double-fork + setsid
// 1. First fork → intermediate child
// 2. setsid() → new session (detach from terminal)
// 3. Second fork → grandchild becomes orphan
// 4. Intermediate child exits → grandchild reparented to init/systemd
// 5. Close ALL file descriptors

// Key functions:
// - fork() twice
// - setsid() between forks
// - close_all_fds() in grandchild
// - redirect stdin/stdout/stderr to /dev/null or log file
// - exec() the command

// NO handles maintained, NO pipes kept open
```

### 2. Sync vs Async Commands

```
SYNC (blocking, fast):
- Native commands (disk_space, memory, cpu, etc.)
- Status checks
- Healthchecks
- Timeout: max 60 seconds

ASYNC (detached, long):
- Start/Stop/Restart
- Custom actions
- Agent returns job_id immediately
- Backend polls for completion via completion_check
```

### 3. Agent Semi-Autonomous Mode

The agent receives a **Snapshot** from the backend containing:
- Components it manages
- Checks to execute (with intervals)
- Commands definitions

The agent then:
1. Schedules checks locally (no server polling)
2. Executes checks autonomously
3. Sends **deltas only** (changes) to reduce traffic
4. Sends immediately on status change (ok→error)
5. Sends batch every 60s for metrics

### 4. Protocol: HTTPS/WSS on Port 443

```
Agent → Gateway: WSS (preferred) or HTTPS (fallback)
Gateway → Backend: WSS
Frontend → Backend: REST + WebSocket

All on port 443 for maximum firewall compatibility.
Agent tries WebSocket first, falls back to HTTPS polling if blocked.
```

### 5. mTLS Certificate Hierarchy

```
Root CA (offline, HSM)
├── Backend CA → backend.crt
├── Gateway CA → gateway-*.crt
└── Agent CA → agent-*.crt

Each component validates the other using the appropriate CA.
```

## Coding Conventions

### Rust (Agent/Gateway)

```rust
// Use async/await with Tokio
// Error handling with thiserror + anyhow
// Serialization with serde + serde_json
// Logging with tracing
// Config with config + serde_yaml

// File structure:
// mod.rs exports public interface
// Internal implementation in separate files

// Naming:
// snake_case for functions, variables
// PascalCase for types, traits
// SCREAMING_SNAKE_CASE for constants
```

### TypeScript (Backend)

```typescript
// Strict mode enabled
// Use interfaces over types when possible
// Async/await everywhere (no callbacks)
// Error handling with custom error classes
// Logging with pino

// File structure:
// index.ts exports public interface
// *.service.ts for business logic
// *.controller.ts for API handlers
// *.repository.ts for database access

// Naming:
// camelCase for functions, variables
// PascalCase for classes, interfaces, types
// SCREAMING_SNAKE_CASE for constants
```

### React (Frontend)

```typescript
// Functional components only
// Hooks for state management
// Zustand for global state
// React Query for server state
// Tailwind for styling
// shadcn/ui for components

// File structure:
// ComponentName/
//   index.tsx (main component)
//   ComponentName.hooks.ts (custom hooks)
//   ComponentName.types.ts (types)
```

## Key Commands

### Development

```bash
# Agent (Rust)
cd agent && cargo run -- --config config/agent.dev.yaml

# Gateway (Rust)
cd gateway && cargo run -- --config config/gateway.dev.yaml

# Backend (Node.js)
cd backend && npm run dev

# Frontend (React)
cd frontend && npm run dev

# All (with docker-compose)
docker-compose -f deploy/docker/docker-compose.dev.yaml up
```

### Testing

```bash
# Agent
cd agent && cargo test

# Gateway
cd gateway && cargo test

# Backend
cd backend && npm test

# Frontend
cd frontend && npm test

# Integration tests
./scripts/integration-tests.sh
```

### Building

```bash
# Agent (cross-compile)
cd agent && cargo build --release --target x86_64-unknown-linux-musl

# Gateway
cd gateway && cargo build --release --target x86_64-unknown-linux-musl

# Backend (Docker)
docker build -f deploy/docker/Dockerfile.backend -t opsmap-backend .

# Frontend (Docker)
docker build -f deploy/docker/Dockerfile.frontend -t opsmap-frontend .
```

## Database Schema (Key Tables)

```sql
-- Core tables
organizations, users, groups, group_members
workspaces, maps, components

-- Permissions
roles, map_permissions_users, map_permissions_groups, map_share_links

-- Agents
agents, gateways, agent_snapshots

-- Operations
jobs, audit_logs, check_results, metrics

-- See full schema in docs/opsmap-specification-v3.md
```

## API Endpoints (Key)

```
# Maps
GET    /api/v1/maps
POST   /api/v1/maps
GET    /api/v1/maps/:id
PUT    /api/v1/maps/:id
DELETE /api/v1/maps/:id
GET    /api/v1/maps/:id/status
POST   /api/v1/maps/:id/start
POST   /api/v1/maps/:id/stop

# Components
POST   /api/v1/maps/:id/components/:componentId/start
POST   /api/v1/maps/:id/components/:componentId/stop
POST   /api/v1/maps/:id/components/:componentId/actions/:actionName

# Agents
GET    /api/v1/agents
GET    /api/v1/agents/:id
POST   /api/v1/agents/:id/command

# Permissions
GET    /api/v1/maps/:id/permissions
POST   /api/v1/maps/:id/permissions/users
DELETE /api/v1/maps/:id/permissions/users/:userId

# WebSocket
WS     /ws (real-time updates)
```

## Environment Variables

```bash
# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/opsmap
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
OIDC_ISSUER=https://login.company.com
OIDC_CLIENT_ID=opsmap
OIDC_CLIENT_SECRET=secret

# Agent
OPSMAP_GATEWAY_URL=wss://gateway.company.com:443
OPSMAP_AGENT_ID=auto
OPSMAP_CERT_FILE=/etc/opsmap/certs/agent.crt
OPSMAP_KEY_FILE=/etc/opsmap/certs/agent.key
OPSMAP_CA_FILE=/etc/opsmap/certs/ca.crt

# Gateway
OPSMAP_BACKEND_URL=wss://backend.company.com:443
OPSMAP_ZONE=production
```

## Current Phase: MVP

Focus on:
1. [x] Agent core (Rust) - connection, native commands, detached execution ✅
2. [x] Gateway core (Rust) - agent registry, routing ✅
3. [x] Backend core (Node.js) - API, WebSocket, basic auth ✅
4. [x] Frontend core (React) - dashboard, map view, basic operations ✅
5. [x] mTLS setup ✅
6. [x] Docker/Kubernetes/OpenShift deployment ✅

## Agent Development (Rust)

### Quick Start

```bash
cd agent

# Build debug
cargo build

# Build release (optimized, ~5MB)
cargo build --release --target x86_64-unknown-linux-musl

# Run with config
./target/release/opsmap-agent --config /etc/opsmap/agent.yaml
```

### Agent Structure

```
agent/src/
├── main.rs               # Entry point, CLI
├── config/               # YAML config loader
├── connection/           # WebSocket to Gateway
├── executor/             # Process execution (CRITICAL: double-fork)
├── scheduler/            # Local check scheduler
├── native_commands/      # Built-in commands (disk, memory, cpu, etc.)
└── buffer/               # Offline buffer for disconnected mode
```

### Key Features

- **Process Detachment**: Double-fork ensures processes survive agent restart
- **Native Commands**: disk_space, memory, cpu, process, tcp_port, http, load_average
- **Local Scheduling**: Executes checks autonomously, sends deltas only
- **Offline Buffer**: Persists data to disk when disconnected

### Configuration

```yaml
# /etc/opsmap/agent.yaml
agent:
  id: auto  # or specific ID

gateway:
  url: wss://gateway.company.com:443
  reconnect_interval_secs: 10

tls:
  enabled: true
  cert_file: /etc/opsmap/certs/agent.crt
  key_file: /etc/opsmap/certs/agent.key
  ca_file: /etc/opsmap/certs/ca.crt

labels:
  role: database
  env: production
```

## Gateway Development (Rust)

### Quick Start

```bash
cd gateway

# Build
cargo build --release

# Run
./target/release/opsmap-gateway --config /etc/opsmap/gateway.yaml
```

### Gateway Structure

```
gateway/src/
├── main.rs               # Entry point, HTTP server
├── agent_server/         # Accept agent WebSocket connections
├── backend_client/       # Connect to Backend
├── registry/             # Agent registry
└── router/               # Command routing
```

### Endpoints

```
GET  /health              # Health check
GET  /metrics             # Prometheus metrics
GET  /agents              # List connected agents
WS   /ws                  # Agent WebSocket endpoint
```

### Configuration

```yaml
# /etc/opsmap/gateway.yaml
gateway:
  id: gateway-1
  zone: production
  listen_addr: 0.0.0.0
  listen_port: 8443

backend:
  url: wss://backend.company.com:443/gateway
  reconnect_interval_secs: 5

tls:
  enabled: true
  cert_file: /etc/opsmap/certs/gateway.crt
  key_file: /etc/opsmap/certs/gateway.key
  ca_file: /etc/opsmap/certs/ca.crt
  verify_clients: true
```

## mTLS Setup

### Generate Certificates

```bash
# Generate full PKI hierarchy
./scripts/pki/generate-certs.sh ./certs opsmap.local

# Output:
# certs/
# ├── root-ca/          # Root CA (keep offline!)
# ├── backend/          # Backend certificates
# ├── gateway/          # Gateway certificates
# ├── agent/            # Agent certificates
# └── ca-bundle.crt     # Combined CA bundle
```

### Certificate Hierarchy

```
Root CA (offline)
├── Backend CA
│   └── backend.crt
├── Gateway CA
│   └── gateway-*.crt
└── Agent CA
    └── agent-*.crt
```

## Backend Development

### Quick Start

```bash
cd backend

# Install dependencies
npm install

# Set up environment (copy and edit)
cp .env.example .env

# Run database migrations
npm run db:migrate

# Seed demo data (optional)
npm run db:seed

# Start development server
npm run dev
```

### Backend Structure

```
backend/src/
├── index.ts              # Entry point
├── config/               # Configuration (env, logger)
├── api/
│   ├── server.ts         # Express app setup
│   ├── middleware/       # Auth, error handling
│   └── routes/           # API route handlers
├── auth/                 # JWT, authentication
├── db/
│   ├── connection.ts     # PostgreSQL pool
│   ├── migrations/       # SQL migrations
│   └── repositories/     # Data access layer
├── types/                # TypeScript interfaces
└── websocket/            # Real-time updates
```

### API Routes

```
POST   /api/v1/auth/login              # Login
POST   /api/v1/auth/register           # Register
GET    /api/v1/auth/me                 # Current user
POST   /api/v1/auth/refresh            # Refresh token

GET    /api/v1/organizations           # List user's orgs
POST   /api/v1/organizations           # Create org
GET    /api/v1/organizations/:id       # Get org details
GET    /api/v1/organizations/:id/workspaces    # List workspaces
POST   /api/v1/organizations/:id/workspaces    # Create workspace
GET    /api/v1/organizations/:id/members       # List members
POST   /api/v1/organizations/:id/members       # Add member

GET    /api/v1/maps                    # List accessible maps
POST   /api/v1/maps                    # Create map
GET    /api/v1/maps/:id                # Get map
PUT    /api/v1/maps/:id                # Update map
DELETE /api/v1/maps/:id                # Delete map

GET    /api/v1/maps/:id/components     # List components
POST   /api/v1/maps/:id/components     # Create component
PUT    /api/v1/maps/:id/components/:cid    # Update component
DELETE /api/v1/maps/:id/components/:cid    # Delete component
POST   /api/v1/maps/:id/components/:cid/start    # Start
POST   /api/v1/maps/:id/components/:cid/stop     # Stop
POST   /api/v1/maps/:id/components/:cid/restart  # Restart

GET    /api/v1/maps/:id/permissions           # Get permissions
POST   /api/v1/maps/:id/permissions/users     # Grant user access
PUT    /api/v1/maps/:id/permissions/users/:uid    # Update
DELETE /api/v1/maps/:id/permissions/users/:uid    # Revoke
POST   /api/v1/maps/:id/share-links           # Create share link
DELETE /api/v1/maps/:id/share-links/:lid      # Delete share link
GET    /api/v1/maps/:id/permissions/check     # Check permission
GET    /api/v1/maps/:id/permissions/effective # Get effective perms

GET    /api/v1/roles                   # List available roles

WS     /ws?token=<jwt>                 # WebSocket connection
```

### WebSocket Protocol

```typescript
// Connect with JWT token
const ws = new WebSocket('ws://localhost:3000/ws?token=YOUR_JWT');

// Subscribe to map updates
ws.send(JSON.stringify({ type: 'subscribe', payload: { mapId: 'uuid' } }));

// Receive updates
ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  // msg.type: 'connected', 'subscribed', 'map_update', 'error'
};

// Unsubscribe
ws.send(JSON.stringify({ type: 'unsubscribe', payload: { mapId: 'uuid' } }));
```

### Demo Credentials

After running `npm run db:seed`:
- Admin: `demo@opsmap.io` / `demo1234`
- Operator: `operator@opsmap.io` / `operator123`

### Adding New Migrations

```bash
npm run db:migrate:create add_feature_table
# Edit: backend/src/db/migrations/<timestamp>_add_feature_table.sql
npm run db:migrate
```

### Testing

```bash
npm test                 # Run tests
npm run test:coverage    # With coverage
npm run typecheck        # Type check only
npm run lint             # Lint
```

## Frontend Development

### Quick Start

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test

# Run E2E tests
npm run test:e2e
```

### Frontend Structure

```
frontend/src/
├── main.tsx              # Entry point
├── App.tsx               # Root component with routing
├── index.css             # Global styles (Tailwind)
├── api/                  # API client and hooks
│   ├── client.ts         # HTTP client with auth
│   └── maps.ts           # React Query hooks for maps
├── components/
│   ├── ui/               # shadcn/ui components
│   ├── layout/           # Layout components
│   └── maps/             # Map-specific components
├── pages/                # Page components
│   ├── LoginPage.tsx
│   ├── DashboardPage.tsx
│   └── MapViewPage.tsx
├── hooks/                # Custom hooks
│   ├── use-toast.ts
│   └── use-websocket.ts
├── stores/               # Zustand stores
│   └── auth.ts
├── types/                # TypeScript types
└── lib/                  # Utilities
```

### Key Features

- **Dashboard**: List of maps with status indicators
- **Map View**: Mermaid diagram with component dependencies
- **Component Controls**: Start/Stop/Restart buttons with permission checks
- **Permissions Modal**: Share maps with users, create share links
- **Real-time Updates**: WebSocket integration for live status

### E2E Tests

```bash
# Run E2E tests
npm run test:e2e

# Run with UI (debug mode)
npm run test:e2e:ui

# Test files in: frontend/e2e/
# - auth.spec.ts       # Login/logout tests
# - dashboard.spec.ts  # Dashboard tests
# - map-view.spec.ts   # Map view tests
# - permissions.spec.ts # Permissions modal tests
```

## Deployment

### Kubernetes

```bash
# Apply all manifests
kubectl apply -f deploy/kubernetes/

# Or step by step
kubectl apply -f deploy/kubernetes/namespace.yaml
kubectl apply -f deploy/kubernetes/configmap.yaml
kubectl apply -f deploy/kubernetes/secret.yaml
kubectl apply -f deploy/kubernetes/postgresql.yaml
kubectl apply -f deploy/kubernetes/redis.yaml
kubectl apply -f deploy/kubernetes/backend-deployment.yaml
kubectl apply -f deploy/kubernetes/frontend-deployment.yaml
kubectl apply -f deploy/kubernetes/ingress.yaml
kubectl apply -f deploy/kubernetes/network-policy.yaml
```

### OpenShift

```bash
# Create project
oc new-project opsmap

# Apply Kubernetes manifests (compatible)
oc apply -f deploy/kubernetes/

# Apply OpenShift-specific resources
oc apply -f deploy/openshift/route.yaml
oc apply -f deploy/openshift/imagestream.yaml
oc apply -f deploy/openshift/buildconfig.yaml
```

### Docker Build

```bash
# Build backend
docker build -f deploy/docker/Dockerfile.backend -t opsmap-backend .

# Build frontend
docker build -f deploy/docker/Dockerfile.frontend -t opsmap-frontend .
```

### Security Features

- Non-root containers
- Read-only root filesystems
- Dropped capabilities
- Network policies (zero-trust)
- Security Context Constraints (OpenShift)

## CI/CD Pipeline

### GitHub Actions Workflows

- **ci.yaml**: Lint, test, build, and scan on every push/PR
- **cve-scan.yaml**: Daily CVE scanning of dependencies and images
- **deploy.yaml**: Manual deployment to staging/production

### CVE Scanning

The CI pipeline **fails the build** if HIGH or CRITICAL CVEs are found:

1. **npm audit**: Scans Node.js dependencies
2. **Trivy**: Scans filesystem, container images, and K8s manifests
3. **Checkov**: IaC security scanning
4. **Kubescape**: Kubernetes security scanning

```bash
# Run locally
npm audit --audit-level=high

# Trivy scan
trivy fs --severity HIGH,CRITICAL .

# Scan container image
trivy image --severity HIGH,CRITICAL opsmap-backend:latest
```

## References

- Full specification: `docs/opsmap-specification-v3.md`
- MayeleAI (FSM engine): https://github.com/fredericcarre/xcomponent-ai
- MCP Protocol: https://modelcontextprotocol.io

## Notes for Claude Code

When working on this project:

1. **Always read the spec first** when implementing a new feature
2. **Process detachment is critical** - test that processes survive agent restart
3. **Port 443 only** - no exotic protocols, enterprise firewalls are strict
4. **Delta-based sync** - agent sends changes only, not full status
5. **Permissions are granular** - check permission before every action
6. **Audit everything** - every action must be logged
7. **mTLS everywhere** - no plaintext communication between components
