// Core entity types for OpsMap

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  settings: Record<string, unknown>;
}

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  authProvider: 'local' | 'oidc' | 'saml';
  authProviderId: string | null;
  createdAt: Date;
  lastLoginAt: Date | null;
}

export interface OrganizationMember {
  id: string;
  organizationId: string;
  userId: string;
  role: 'owner' | 'admin' | 'member';
  joinedAt: Date;
}

export interface Group {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  createdAt: Date;
}

export interface GroupMember {
  id: string;
  groupId: string;
  userId: string;
  addedAt: Date;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
}

export interface Map {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  description: string | null;
  ownerId: string;
  gitRepoUrl: string | null;
  gitBranch: string;
  yaml: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Component {
  id: string;
  mapId: string;
  name: string;
  type: string;
  config: ComponentConfig;
  position: { x: number; y: number };
  createdAt: Date;
  updatedAt: Date;
}

export interface ComponentConfig {
  agentSelector?: AgentSelector;
  checks?: Check[];
  actions?: Action[];
  dependencies?: string[];
  metadata?: Record<string, unknown>;
}

export interface AgentSelector {
  agentId?: string;
  labels?: Record<string, string>;
}

export interface Check {
  name: string;
  type: 'http' | 'tcp' | 'command' | 'process' | 'service';
  config: Record<string, unknown>;
  intervalSecs: number;
  timeoutSecs: number;
}

export interface Action {
  name: string;
  label: string;
  command: string;
  args?: string[];
  runAsUser?: string;
  async: boolean;
  confirmationRequired?: boolean;
  completionCheck?: Check;
}

// Permissions
export interface Role {
  id: string;
  name: 'viewer' | 'operator' | 'editor' | 'admin' | 'restricted_operator';
  description: string | null;
  permissions: RolePermissions;
}

export interface RolePermissions {
  map: string[];
  component: string[];
  action: string[];
}

export interface MapPermissionUser {
  id: string;
  mapId: string;
  userId: string;
  roleId: string;
  permissionOverrides: PermissionOverrides;
  grantedBy: string;
  grantedAt: Date;
  expiresAt: Date | null;
}

export interface MapPermissionGroup {
  id: string;
  mapId: string;
  groupId: string;
  roleId: string;
  permissionOverrides: PermissionOverrides;
  grantedBy: string;
  grantedAt: Date;
}

export interface PermissionOverrides {
  components?: Record<string, { allow?: string[]; deny?: string[] }>;
  actions?: Record<string, Record<string, 'allow' | 'deny'>>;
}

export interface MapShareLink {
  id: string;
  mapId: string;
  token: string;
  roleId: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date | null;
  passwordHash: string | null;
  maxUses: number | null;
  useCount: number;
  isActive: boolean;
}

// Audit
export interface AuditLog {
  id: string;
  timestamp: Date;
  action: string;
  actorType: 'user' | 'system' | 'agent';
  actorId: string;
  actorEmail: string | null;
  actorIp: string | null;
  targetType: 'map' | 'component' | 'user' | 'organization' | 'workspace' | 'permission';
  targetId: string;
  details: Record<string, unknown>;
  organizationId: string;
}

// Agents and Gateways
export interface Gateway {
  id: string;
  name: string;
  zone: string;
  url: string;
  status: 'online' | 'offline' | 'degraded';
  lastHeartbeat: Date | null;
  connectedAgents: number;
  createdAt: Date;
}

export interface Agent {
  id: string;
  gatewayId: string;
  hostname: string;
  labels: Record<string, string>;
  status: 'online' | 'offline';
  lastHeartbeat: Date | null;
  version: string | null;
  os: string | null;
  createdAt: Date;
}

// Jobs
export interface Job {
  id: string;
  type: 'command' | 'action' | 'check';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  mapId: string | null;
  componentId: string | null;
  agentId: string;
  command: string;
  args: string[];
  result: JobResult | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  createdBy: string;
}

export interface JobResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

// API Request/Response types
export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}
