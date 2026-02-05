# OpsMap API Reference

Base URL: `https://your-opsmap-server/api/v1`

All endpoints require a Bearer token (`Authorization: Bearer <jwt>`) unless otherwise noted.

---

## Authentication

### POST /auth/login

Authenticate and receive a JWT token.

```bash
curl -X POST https://opsmap.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "demo@opsmap.io", "password": "demo1234"}'
```

**Response** `200 OK`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "refreshToken": "rt_abc123...",
  "user": {
    "id": "usr-001",
    "email": "demo@opsmap.io",
    "name": "Demo Admin",
    "role": "admin"
  }
}
```

### POST /auth/register

```bash
curl -X POST https://opsmap.example.com/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "user@company.com", "password": "securePass123!", "name": "Jane Doe"}'
```

**Response** `201 Created`
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "usr-002",
    "email": "user@company.com",
    "name": "Jane Doe"
  }
}
```

### GET /auth/me

```bash
curl https://opsmap.example.com/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

**Response** `200 OK`
```json
{
  "id": "usr-001",
  "email": "demo@opsmap.io",
  "name": "Demo Admin",
  "role": "admin",
  "organizationId": "org-001"
}
```

### POST /auth/refresh

```bash
curl -X POST https://opsmap.example.com/api/v1/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refreshToken": "rt_abc123..."}'
```

---

## Organizations

### GET /organizations

```bash
curl https://opsmap.example.com/api/v1/organizations \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "org-001",
      "name": "Acme Corp",
      "slug": "acme-corp",
      "createdAt": "2025-01-15T10:00:00Z"
    }
  ]
}
```

### POST /organizations

```bash
curl -X POST https://opsmap.example.com/api/v1/organizations \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Acme Corp"}'
```

---

## Maps

### GET /maps

List all maps accessible to the authenticated user.

```bash
curl https://opsmap.example.com/api/v1/maps \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "map-001",
      "name": "Trading Platform",
      "slug": "trading-platform",
      "description": "Production trading stack",
      "workspaceId": "ws-001",
      "ownerId": "usr-001",
      "createdAt": "2025-01-20T08:30:00Z",
      "updatedAt": "2025-02-01T14:22:00Z"
    }
  ]
}
```

### POST /maps

```bash
curl -X POST https://opsmap.example.com/api/v1/maps \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trading Platform",
    "description": "Production trading stack",
    "workspaceId": "ws-001"
  }'
```

### GET /maps/:id

```bash
curl https://opsmap.example.com/api/v1/maps/map-001 \
  -H "Authorization: Bearer $TOKEN"
```

### PUT /maps/:id

```bash
curl -X PUT https://opsmap.example.com/api/v1/maps/map-001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description": "Updated description"}'
```

### DELETE /maps/:id

```bash
curl -X DELETE https://opsmap.example.com/api/v1/maps/map-001 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204 No Content`

---

## Components

### GET /maps/:id/components

List all components in a map.

```bash
curl https://opsmap.example.com/api/v1/maps/map-001/components \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "comp-001",
      "name": "trading-api",
      "type": "service",
      "config": {
        "agentSelector": { "labels": { "role": "api", "env": "production" } },
        "checks": [
          {
            "name": "health",
            "type": "http",
            "config": { "url": "http://localhost:8080/health", "expectedStatus": 200 },
            "intervalSecs": 30,
            "timeoutSecs": 10
          }
        ],
        "actions": [
          { "name": "start", "label": "Start", "command": "systemctl start trading-api", "async": true },
          { "name": "stop", "label": "Stop", "command": "systemctl stop trading-api", "async": true },
          { "name": "restart", "label": "Restart", "command": "systemctl restart trading-api", "async": true }
        ]
      },
      "position": { "x": 100, "y": 200 }
    }
  ]
}
```

### POST /maps/:id/components

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/components \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "redis-cache",
    "type": "service",
    "config": {
      "agentSelector": { "labels": { "role": "cache" } },
      "checks": [
        { "name": "port", "type": "tcp", "config": { "port": 6379 }, "intervalSecs": 15, "timeoutSecs": 5 }
      ],
      "actions": [
        { "name": "restart", "label": "Restart Redis", "command": "systemctl restart redis", "async": true }
      ]
    }
  }'
```

### POST /maps/:id/components/:cid/start

Execute the "start" action on a component.

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/start \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "success": true,
  "jobId": "job-abc-123",
  "mode": "async",
  "message": "Command sent to agent"
}
```

### POST /maps/:id/components/:cid/stop

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/stop \
  -H "Authorization: Bearer $TOKEN"
```

### POST /maps/:id/components/:cid/restart

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/restart \
  -H "Authorization: Bearer $TOKEN"
```

---

## Check Results & Status

### GET /maps/:mapId/status

Get real-time status of all components in a map.

```bash
curl https://opsmap.example.com/api/v1/maps/map-001/status \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "componentId": "comp-001",
      "componentName": "trading-api",
      "status": "ok",
      "lastCheck": "2025-02-05T14:30:00Z"
    },
    {
      "componentId": "comp-002",
      "componentName": "redis-cache",
      "status": "error",
      "lastCheck": "2025-02-05T14:29:45Z"
    },
    {
      "componentId": "comp-003",
      "componentName": "postgresql",
      "status": "ok",
      "lastCheck": "2025-02-05T14:30:10Z"
    }
  ]
}
```

### GET /maps/:mapId/components/:componentId/status

Get the current health status of a specific component.

```bash
curl https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/status \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "status": "ok",
  "checks": [
    {
      "id": "cr-001",
      "componentId": "comp-001",
      "checkName": "health",
      "status": "ok",
      "message": "HTTP 200 in 45ms",
      "metrics": { "response_time_ms": 45, "status_code": 200 },
      "durationMs": 45,
      "checkedAt": "2025-02-05T14:30:00Z"
    },
    {
      "id": "cr-002",
      "componentId": "comp-001",
      "checkName": "port",
      "status": "ok",
      "message": "Port 8080 open",
      "durationMs": 2,
      "checkedAt": "2025-02-05T14:30:05Z"
    }
  ]
}
```

### GET /maps/:mapId/components/:componentId/checks

Get historical check results. Supports `limit` and `checkName` query parameters.

```bash
# All checks, last 50
curl "https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/checks?limit=50" \
  -H "Authorization: Bearer $TOKEN"

# Filter by check name
curl "https://opsmap.example.com/api/v1/maps/map-001/components/comp-001/checks?checkName=health&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "cr-100",
      "componentId": "comp-001",
      "checkName": "health",
      "status": "ok",
      "message": "HTTP 200 in 42ms",
      "metrics": { "response_time_ms": 42 },
      "durationMs": 42,
      "checkedAt": "2025-02-05T14:30:00Z"
    },
    {
      "id": "cr-099",
      "componentId": "comp-001",
      "checkName": "health",
      "status": "error",
      "message": "Connection refused",
      "durationMs": 10002,
      "checkedAt": "2025-02-05T14:29:30Z"
    }
  ]
}
```

---

## Groups

### GET /organizations/:orgId/groups

List all groups in an organization with member counts.

```bash
curl https://opsmap.example.com/api/v1/organizations/org-001/groups \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "grp-001",
      "organizationId": "org-001",
      "name": "Platform Team",
      "description": "Core platform engineers",
      "memberCount": 5,
      "createdAt": "2025-01-15T10:00:00Z"
    },
    {
      "id": "grp-002",
      "organizationId": "org-001",
      "name": "SRE Team",
      "description": null,
      "memberCount": 3,
      "createdAt": "2025-01-20T09:00:00Z"
    }
  ]
}
```

### POST /organizations/:orgId/groups

```bash
curl -X POST https://opsmap.example.com/api/v1/organizations/org-001/groups \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Database Team", "description": "DBA and database engineers"}'
```

**Response** `201 Created`
```json
{
  "id": "grp-003",
  "organizationId": "org-001",
  "name": "Database Team",
  "description": "DBA and database engineers",
  "createdAt": "2025-02-05T15:00:00Z"
}
```

### GET /groups/:id

Get group details with member list.

```bash
curl https://opsmap.example.com/api/v1/groups/grp-001 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "id": "grp-001",
  "organizationId": "org-001",
  "name": "Platform Team",
  "description": "Core platform engineers",
  "createdAt": "2025-01-15T10:00:00Z",
  "members": [
    { "id": "gm-001", "userId": "usr-001", "email": "demo@opsmap.io", "name": "Demo Admin", "addedAt": "2025-01-15T10:00:00Z" },
    { "id": "gm-002", "userId": "usr-002", "email": "operator@opsmap.io", "name": "Operator", "addedAt": "2025-01-16T08:00:00Z" }
  ]
}
```

### PUT /groups/:id

```bash
curl -X PUT https://opsmap.example.com/api/v1/groups/grp-001 \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Platform Engineering", "description": "Updated description"}'
```

### DELETE /groups/:id

```bash
curl -X DELETE https://opsmap.example.com/api/v1/groups/grp-001 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204 No Content`

### POST /groups/:id/members

```bash
curl -X POST https://opsmap.example.com/api/v1/groups/grp-001/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "usr-003"}'
```

**Response** `201 Created`
```json
{
  "id": "gm-003",
  "groupId": "grp-001",
  "userId": "usr-003",
  "addedAt": "2025-02-05T15:30:00Z"
}
```

### DELETE /groups/:id/members/:userId

```bash
curl -X DELETE https://opsmap.example.com/api/v1/groups/grp-001/members/usr-003 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `204 No Content`

### GET /groups/:id/members

```bash
curl https://opsmap.example.com/api/v1/groups/grp-001/members \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    { "id": "gm-001", "userId": "usr-001", "email": "demo@opsmap.io", "name": "Demo Admin", "addedAt": "2025-01-15T10:00:00Z" }
  ]
}
```

---

## Permissions

### GET /maps/:id/permissions

```bash
curl https://opsmap.example.com/api/v1/maps/map-001/permissions \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "users": [
    { "userId": "usr-001", "role": "admin", "email": "demo@opsmap.io" },
    { "userId": "usr-002", "role": "operator", "email": "operator@opsmap.io" }
  ],
  "groups": [
    { "groupId": "grp-001", "role": "editor", "name": "Platform Team" }
  ],
  "shareLinks": [
    { "id": "sl-001", "role": "viewer", "expiresAt": "2025-03-01T00:00:00Z" }
  ]
}
```

### POST /maps/:id/permissions/users

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/permissions/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "usr-003", "role": "operator"}'
```

### GET /maps/:id/permissions/check

Check if the current user has a specific permission.

```bash
curl "https://opsmap.example.com/api/v1/maps/map-001/permissions/check?action=execute" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "allowed": true,
  "role": "operator"
}
```

---

## Gateways & Agents

### GET /gateways

```bash
curl https://opsmap.example.com/api/v1/gateways \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "gw-001",
      "name": "gateway-prd-01",
      "zone": "production",
      "status": "online",
      "agentCount": 12,
      "lastHeartbeat": "2025-02-05T14:30:00Z"
    }
  ]
}
```

### GET /agents

```bash
curl https://opsmap.example.com/api/v1/agents \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "agent-001",
      "hostname": "srv-api-01",
      "labels": { "role": "api", "env": "production" },
      "status": "online",
      "version": "0.5.0",
      "os": "linux",
      "gatewayId": "gw-001",
      "lastHeartbeat": "2025-02-05T14:30:05Z"
    }
  ]
}
```

### GET /agents/:id

```bash
curl https://opsmap.example.com/api/v1/agents/agent-001 \
  -H "Authorization: Bearer $TOKEN"
```

### GET /jobs/:id

Get the status of an async job (command execution).

```bash
curl https://opsmap.example.com/api/v1/jobs/job-abc-123 \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "id": "job-abc-123",
  "type": "command",
  "componentId": "comp-001",
  "command": "systemctl restart trading-api",
  "status": "completed",
  "result": { "exitCode": 0, "stdout": "", "stderr": "" },
  "createdAt": "2025-02-05T14:25:00Z",
  "completedAt": "2025-02-05T14:25:03Z"
}
```

---

## Audit Logs

### GET /audit-logs

Query audit logs with optional filters.

```bash
# All recent audit logs
curl "https://opsmap.example.com/api/v1/audit-logs?limit=20" \
  -H "Authorization: Bearer $TOKEN"

# Filter by action
curl "https://opsmap.example.com/api/v1/audit-logs?action=component.start&limit=10" \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "data": [
    {
      "id": "audit-001",
      "userId": "usr-001",
      "action": "component.start",
      "targetType": "component",
      "targetId": "comp-001",
      "details": { "mapId": "map-001", "componentName": "trading-api" },
      "ipAddress": "10.0.1.50",
      "createdAt": "2025-02-05T14:25:00Z"
    }
  ]
}
```

### GET /audit-logs/target/:targetType/:targetId

```bash
curl https://opsmap.example.com/api/v1/audit-logs/target/component/comp-001 \
  -H "Authorization: Bearer $TOKEN"
```

---

## GitOps

### GET /maps/:mapId/export

Export a map as a JSON definition for GitOps workflows.

```bash
curl https://opsmap.example.com/api/v1/maps/map-001/export \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "name": "Trading Platform",
  "description": "Production trading stack",
  "components": [
    {
      "id": "trading-api",
      "name": "trading-api",
      "type": "service",
      "agent_selector": {
        "labels": { "role": "api", "env": "production" }
      },
      "checks": [
        {
          "name": "health",
          "type": "http",
          "config": { "url": "http://localhost:8080/health", "expectedStatus": 200 },
          "interval_secs": 30,
          "timeout_secs": 10
        }
      ],
      "actions": [
        { "name": "start", "label": "Start", "command": "systemctl start trading-api", "async": true },
        { "name": "stop", "label": "Stop", "command": "systemctl stop trading-api", "async": true },
        { "name": "restart", "label": "Restart", "command": "systemctl restart trading-api", "async": true }
      ]
    },
    {
      "id": "redis-cache",
      "name": "redis-cache",
      "type": "service",
      "agent_selector": {
        "labels": { "role": "cache" }
      },
      "checks": [
        { "name": "port", "type": "tcp", "config": { "port": 6379 }, "interval_secs": 15, "timeout_secs": 5 }
      ],
      "actions": [
        { "name": "restart", "label": "Restart", "command": "systemctl restart redis", "async": true }
      ]
    }
  ]
}
```

### POST /maps/:mapId/import

Import a map definition, creating/updating/deleting components to match.

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Trading Platform",
    "components": [
      {
        "id": "trading-api",
        "name": "trading-api",
        "type": "service",
        "agent_selector": { "labels": { "role": "api" } },
        "checks": [
          { "name": "health", "type": "http", "config": { "url": "http://localhost:8080/health" }, "interval_secs": 30, "timeout_secs": 10 }
        ],
        "actions": [
          { "name": "start", "label": "Start", "command": "systemctl start trading-api", "async": true }
        ]
      }
    ]
  }'
```

**Response** `200 OK`
```json
{
  "created": 0,
  "updated": 1,
  "deleted": 1
}
```

### POST /maps/:mapId/import/preview

Preview the changes that an import would make, without applying them.

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/import/preview \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "components": [...] }'
```

**Response** `200 OK`
```json
{
  "added": ["new-service"],
  "removed": ["old-service"],
  "changed": ["trading-api"],
  "unchanged": ["redis-cache"]
}
```

### POST /maps/:mapId/sync

Sync a map from its configured Git repository. The map must have `gitRepoUrl` configured.

```bash
curl -X POST https://opsmap.example.com/api/v1/maps/map-001/sync \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "synced": true,
  "message": "Synced: 2 created, 3 updated, 1 deleted"
}
```

**Error** `400 Bad Request` (no Git repo configured)
```json
{
  "error": "No Git repository URL configured for this map"
}
```

---

## MCP (Model Context Protocol)

OpsMap exposes its capabilities as MCP tools for AI assistant integration.

### GET /mcp/tools

List all available MCP tools.

```bash
curl https://opsmap.example.com/api/v1/mcp/tools \
  -H "Authorization: Bearer $TOKEN"
```

**Response** `200 OK`
```json
{
  "tools": [
    {
      "name": "list_maps",
      "description": "List all application maps accessible to the current user.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "workspaceId": { "type": "string", "description": "Filter by workspace ID (optional)" }
        },
        "required": []
      }
    },
    {
      "name": "get_map_status",
      "description": "Get the real-time status of all components in a map.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": { "type": "string", "description": "The ID of the map" }
        },
        "required": ["mapId"]
      }
    },
    {
      "name": "get_component_details",
      "description": "Get detailed information about a specific component.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "componentId": { "type": "string", "description": "The ID of the component" }
        },
        "required": ["componentId"]
      }
    },
    {
      "name": "execute_action",
      "description": "Execute an action on a component.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "mapId": { "type": "string", "description": "The map ID" },
          "componentId": { "type": "string", "description": "The component ID" },
          "action": { "type": "string", "description": "Action name" },
          "userId": { "type": "string", "description": "User ID" }
        },
        "required": ["mapId", "componentId", "action", "userId"]
      }
    },
    {
      "name": "list_agents",
      "description": "List all registered agents with their connection status.",
      "inputSchema": { "type": "object", "properties": {}, "required": [] }
    },
    {
      "name": "get_check_history",
      "description": "Get historical check results for a component.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "componentId": { "type": "string", "description": "The component ID" },
          "checkName": { "type": "string", "description": "Specific check name (optional)" },
          "limit": { "type": "number", "description": "Max results (default: 50)" }
        },
        "required": ["componentId"]
      }
    },
    {
      "name": "get_job_status",
      "description": "Get the current status of a job.",
      "inputSchema": {
        "type": "object",
        "properties": {
          "jobId": { "type": "string", "description": "The job ID" }
        },
        "required": ["jobId"]
      }
    }
  ]
}
```

### POST /mcp/tools/call

Execute an MCP tool.

```bash
# List all maps
curl -X POST https://opsmap.example.com/api/v1/mcp/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "list_maps", "arguments": {}}'
```

**Response** `200 OK`
```json
{
  "content": [
    {
      "type": "text",
      "text": "{\n  \"maps\": [\n    {\n      \"id\": \"map-001\",\n      \"name\": \"Trading Platform\",\n      \"componentCount\": 5\n    }\n  ]\n}"
    }
  ]
}
```

```bash
# Get map status
curl -X POST https://opsmap.example.com/api/v1/mcp/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "get_map_status", "arguments": {"mapId": "map-001"}}'
```

```bash
# Execute an action
curl -X POST https://opsmap.example.com/api/v1/mcp/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "execute_action",
    "arguments": {
      "mapId": "map-001",
      "componentId": "comp-001",
      "action": "restart",
      "userId": "usr-001"
    }
  }'
```

---

## WebSocket

Connect to receive real-time updates.

```javascript
const ws = new WebSocket('wss://opsmap.example.com/ws?token=YOUR_JWT');

ws.onopen = () => {
  // Subscribe to map updates
  ws.send(JSON.stringify({
    type: 'subscribe',
    payload: { mapId: 'map-001' }
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.type) {
    case 'connected':
      console.log('Connected:', msg.payload);
      break;
    case 'subscribed':
      console.log('Subscribed to map:', msg.payload.mapId);
      break;
    case 'map_update':
      console.log('Component status changed:', msg.payload);
      // { componentId, componentName, status, checkName, ... }
      break;
    case 'error':
      console.error('Error:', msg.payload.message);
      break;
  }
};

// Unsubscribe
ws.send(JSON.stringify({
  type: 'unsubscribe',
  payload: { mapId: 'map-001' }
}));
```

---

## Health Check

### GET /health

No authentication required.

```bash
curl https://opsmap.example.com/health
```

**Response** `200 OK`
```json
{
  "status": "ok",
  "timestamp": "2025-02-05T14:30:00.000Z"
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE"
}
```

Common HTTP status codes:

| Status | Meaning |
|--------|---------|
| 400 | Bad Request -- missing or invalid parameters |
| 401 | Unauthorized -- missing or expired token |
| 403 | Forbidden -- insufficient permissions |
| 404 | Not Found -- resource does not exist |
| 429 | Rate Limited -- too many requests (1000/15min for API, 20/15min for auth) |
| 500 | Internal Server Error |

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| `/api/*` | 1000 requests per 15 minutes |
| `/api/v1/auth/login` | 20 attempts per 15 minutes |
| `/api/v1/auth/register` | 20 attempts per 15 minutes |
