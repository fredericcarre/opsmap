# OpsMap

**Lightweight AIOps for mapping, monitoring, and controlling enterprise applications.**

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](.github/workflows/ci.yaml)
[![Rust](https://img.shields.io/badge/rust-1.75+-orange.svg)](https://www.rust-lang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/react-18-61DAFB.svg)](https://react.dev/)

---

OpsMap gives operations teams a single pane of glass to **map** application dependencies, **monitor** real-time health, and **control** distributed services (start/stop/restart) across network zones -- all through a firewall-friendly, zero-trust architecture running entirely over port 443.

## Architecture

```
                          +--------------------------+
                          |        Frontend          |
                          |   React + Vite + shadcn  |
                          +------------+-------------+
                                       | REST + WebSocket
                                       v
                          +--------------------------+     +------------------+
                          |         Backend          |---->|  PostgreSQL 16   |
                          |    Node.js / TypeScript   |---->|  + Redis 7       |
                          |                          |     +------------------+
                          |   API / WebSocket / MCP  |
                          |   FSM Engine / GitOps    |
                          +------------+-------------+
                                       | mTLS (WSS :443)
                    +------------------+------------------+
                    |                  |                  |
              +-----v------+    +-----v------+    +------v-----+
              |  Gateway   |    |  Gateway   |    |  Gateway   |
              |  Zone: DMZ |    |  Zone: PRD |    |  Zone: DEV |
              |   (Rust)   |    |   (Rust)   |    |   (Rust)   |
              +-----+------+    +-----+------+    +------+-----+
                    | mTLS            | mTLS              | mTLS
               +----+----+      +----+----+         +----+----+
               |  Agent  |      |  Agent  |         |  Agent  |
               |  (Rust) |      |  (Rust) |         |  (Rust) |
               +---------+      +---------+         +---------+
               Hosts / VMs / Containers per zone
```

**Agents** run on each managed host, execute health checks autonomously, and report only state changes (deltas). **Gateways** relay traffic between network zones with full mTLS verification. **Backend** provides the REST API, WebSocket server, state machine engine, and MCP integration. **Frontend** renders interactive topology maps with live status updates.

All communication is outbound-only from agents and uses HTTPS/WSS on port 443 for maximum firewall compatibility.

## Key Features

- **Application Topology Maps** -- model multi-tier applications as dependency graphs, visualized as interactive Mermaid diagrams and versioned in Git
- **Semi-Autonomous Agents** -- agents schedule and execute checks locally, reporting only deltas to minimize network traffic
- **Process Detachment** -- double-fork execution ensures managed processes survive agent restarts or crashes
- **Zone Architecture** -- gateways segment traffic by network zone (DMZ, production, development); agents never accept inbound connections
- **Firewall-Friendly** -- all communication over HTTPS/WSS on port 443; no exotic protocols or non-standard ports
- **mTLS Everywhere** -- mutual TLS authentication between all components with a full PKI certificate hierarchy
- **Granular RBAC** -- role-based permissions (admin, operator, editor, viewer) at the map level with user, group, and share-link access
- **Real-Time Updates** -- WebSocket push for instant status changes from agents through to the browser
- **GitOps Native** -- maps are versioned in Git; every change is a traceable commit
- **Offline Resilience** -- agents buffer data to disk when disconnected and replay on reconnection
- **Enterprise SSO** -- OIDC/SAML integration for single sign-on with corporate identity providers
- **Scalable** -- event-driven architecture supporting 50,000+ components per instance

## Tech Stack

| Component    | Technology                            | Purpose                               |
|--------------|---------------------------------------|---------------------------------------|
| **Agent**    | Rust (Tokio, sysinfo, nix)            | On-host monitoring and process control|
| **Gateway**  | Rust (Axum, rustls, Prometheus)       | Zone relay, agent registry, mTLS      |
| **Backend**  | Node.js / TypeScript (Express, ws)    | REST API, WebSocket, FSM, MCP server  |
| **Frontend** | React 18, Vite, Tailwind, shadcn/ui   | Dashboard, map visualization, RBAC UI |
| **Database** | PostgreSQL 16 + Redis 7               | Persistent storage and caching        |
| **Auth**     | JWT + OIDC / SAML                     | Enterprise SSO, role-based access     |
| **CI/CD**    | GitHub Actions, Trivy, Checkov        | Build, test, CVE scanning, deploy     |

## Quick Start

### Docker Compose (recommended)

```bash
docker-compose -f deploy/docker/docker-compose.dev.yaml up
```

This starts PostgreSQL, Redis, the backend (port 3000), and the frontend (port 5173).

### Individual Components

**Prerequisites:** Rust 1.75+, Node.js >= 20, PostgreSQL 16, Redis 7

```bash
# 1. Backend
cd backend
npm install
cp .env.example .env            # configure DATABASE_URL, REDIS_URL, JWT_SECRET
npm run db:migrate
npm run db:seed                 # optional: creates demo users
npm run dev                     # starts on :3000

# 2. Frontend
cd frontend
npm install
npm run dev                     # starts on :5173

# 3. Gateway
cd gateway
cargo run -- --config config/gateway.dev.yaml

# 4. Agent
cd agent
cargo run -- --config config/agent.dev.yaml
```

**Demo credentials** (after `npm run db:seed`):

| Role     | Email                | Password    |
|----------|----------------------|-------------|
| Admin    | demo@opsmap.io       | demo1234    |
| Operator | operator@opsmap.io   | operator123 |

## Project Structure

```
opsmap/
├── agent/                  # Rust agent (~5MB static binary)
│   └── src/
│       ├── config/         # YAML configuration loader
│       ├── connection/     # WebSocket/HTTPS to Gateway
│       ├── executor/       # Detached process execution (double-fork)
│       ├── scheduler/      # Autonomous check scheduler
│       ├── native_commands/# Built-in: disk, memory, cpu, tcp, http
│       ├── discovery/      # Auto-discovery
│       └── buffer/         # Offline data buffer
├── gateway/                # Rust gateway (zone relay)
│   └── src/
│       ├── agent_server/   # Accept agent WebSocket connections
│       ├── backend_client/ # Upstream connection to backend
│       ├── registry/       # Connected agent registry
│       └── router/         # Command routing
├── backend/                # Node.js/TypeScript API server
│   └── src/
│       ├── api/            # Express routes and middleware
│       ├── auth/           # JWT, OIDC/SAML authentication
│       ├── core/           # Maps, commands, permissions, FSM
│       ├── db/             # Migrations and repositories
│       ├── websocket/      # Real-time update server
│       ├── mcp/            # MCP server integration
│       └── gitops/         # Git sync engine
├── frontend/               # React single-page application
│   └── src/
│       ├── pages/          # Dashboard, MapView, Login
│       ├── components/     # UI (shadcn/ui), layout, maps
│       ├── api/            # HTTP client, React Query hooks
│       ├── stores/         # Zustand global state
│       └── hooks/          # WebSocket, toast hooks
├── deploy/
│   ├── docker/             # Dockerfiles, docker-compose
│   ├── kubernetes/         # Kubernetes manifests
│   ├── openshift/          # OpenShift routes, BuildConfigs
│   └── helm/               # Helm charts
├── scripts/
│   └── pki/                # mTLS certificate generation
└── docs/                   # Full specification
```

## Testing

```bash
# Agent (Rust)
cd agent && cargo test

# Gateway (Rust)
cd gateway && cargo test

# Backend (Node.js)
cd backend && npm test                  # unit tests (Vitest)
cd backend && npm run test:coverage     # with coverage report
cd backend && npm run typecheck         # TypeScript type checking
cd backend && npm run lint              # ESLint

# Frontend (React)
cd frontend && npm test                 # unit tests (Vitest)
cd frontend && npm run test:e2e         # E2E tests (Playwright)
cd frontend && npm run test:e2e:ui      # E2E with interactive UI

# Integration
./scripts/integration-tests.sh
```

## Deployment

### Docker

```bash
# Build container images
docker build -f deploy/docker/Dockerfile.backend  -t opsmap-backend .
docker build -f deploy/docker/Dockerfile.frontend -t opsmap-frontend .

# Build agent as a static binary
cd agent && cargo build --release --target x86_64-unknown-linux-musl
# Output: target/x86_64-unknown-linux-musl/release/opsmap-agent (~5MB)
```

### Kubernetes

```bash
kubectl apply -f deploy/kubernetes/
```

Deploys the full stack: namespace, ConfigMaps, Secrets, PostgreSQL, Redis, backend, frontend, Ingress, and NetworkPolicies.

### OpenShift

```bash
oc new-project opsmap
oc apply -f deploy/kubernetes/          # base manifests (compatible)
oc apply -f deploy/openshift/           # Routes, ImageStreams, BuildConfigs
```

### mTLS Certificate Generation

```bash
./scripts/pki/generate-certs.sh ./certs opsmap.local
```

Creates the full PKI hierarchy: Root CA with separate intermediate CAs for backend, gateways, and agents.

## Security

OpsMap follows a zero-trust security model:

- **mTLS** -- mutual TLS between all components using a three-tier X.509 certificate hierarchy (Root CA, Component CAs, leaf certificates)
- **Port 443 only** -- standard HTTPS/WSS ensures compatibility with strict enterprise firewalls
- **Outbound-only agents** -- agents initiate all connections; no inbound ports required on managed hosts
- **RBAC** -- granular role-based access control (admin, operator, editor, viewer) enforced per map
- **Audit trail** -- every action is logged with user identity, timestamp, and context for compliance
- **Enterprise SSO** -- OIDC and SAML support for corporate identity provider integration
- **Container hardening** -- non-root users, read-only root filesystems, dropped capabilities, SecurityContextConstraints (OpenShift)
- **Network policies** -- Kubernetes NetworkPolicies enforce zero-trust pod-to-pod communication
- **CVE scanning** -- CI pipeline integrates npm audit, Trivy, Checkov, and Kubescape; builds fail on HIGH or CRITICAL vulnerabilities

## Configuration

Components are configured via YAML files and environment variables. Key settings:

```bash
# Backend
DATABASE_URL=postgresql://user:pass@localhost:5432/opsmap
REDIS_URL=redis://localhost:6379
JWT_SECRET=your-secret-key
OIDC_ISSUER=https://login.company.com

# Agent
OPSMAP_GATEWAY_URL=wss://gateway.company.com:443
OPSMAP_CERT_FILE=/etc/opsmap/certs/agent.crt
OPSMAP_KEY_FILE=/etc/opsmap/certs/agent.key
OPSMAP_CA_FILE=/etc/opsmap/certs/ca.crt

# Gateway
OPSMAP_BACKEND_URL=wss://backend.company.com:443
OPSMAP_ZONE=production
```

See the full reference in [`docs/opsmap-specification-v3.md`](docs/opsmap-specification-v3.md).

## License

This project is licensed under the [Apache License 2.0](LICENSE).

---

Built for enterprise operations teams who need visibility and control across distributed systems.
