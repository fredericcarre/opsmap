// Core types matching backend
export interface User {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface Workspace {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  description: string | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface Component {
  id: string;
  mapId: string;
  externalId: string;
  name: string;
  type: string;
  config: ComponentConfig;
  position: { x: number; y: number };
  status?: ComponentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ComponentConfig {
  agentSelector?: {
    agentId?: string;
    labels?: Record<string, string>;
  };
  checks?: Check[];
  actions?: Action[];
  dependencies?: string[];
  metadata?: Record<string, unknown>;
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
  async: boolean;
  confirmationRequired?: boolean;
}

export type ComponentStatus = 'ok' | 'warning' | 'error' | 'unknown' | 'starting' | 'stopping';

export interface Role {
  id: string;
  name: 'viewer' | 'operator' | 'editor' | 'admin';
  description: string;
}

export interface MapPermission {
  user?: {
    id: string;
    email: string;
    name: string | null;
  };
  group?: {
    id: string;
    name: string;
    memberCount: number;
  };
  role: string;
  grantedAt: string;
}

export interface MapPermissions {
  owner: User;
  users: MapPermission[];
  groups: MapPermission[];
  shareLinks: ShareLink[];
}

export interface ShareLink {
  id: string;
  token: string;
  role: string;
  expiresAt: string | null;
  useCount: number;
  maxUses: number | null;
}

// API response types
export interface ApiResponse<T> {
  data: T;
}

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

// Auth types
export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: User;
  token: string;
  refreshToken: string;
  expiresIn: number;
}

// WebSocket message types
export interface WsMessage {
  type: string;
  payload?: unknown;
}

export interface WsComponentStatus {
  mapId: string;
  componentId: string;
  status: ComponentStatus;
  message?: string;
  timestamp: string;
}
