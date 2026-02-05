-- OpsMap Initial Schema
-- Migration: 001_initial_schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================================
-- CORE TABLES
-- ============================================================================

-- Organizations (Tenants)
CREATE TABLE organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb
);

-- Users
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255),
    password_hash VARCHAR(255), -- NULL for OIDC/SAML users
    avatar_url TEXT,
    auth_provider VARCHAR(50) DEFAULT 'local',  -- 'oidc', 'local', 'saml'
    auth_provider_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

-- Organization Members
CREATE TABLE organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL DEFAULT 'member',  -- 'owner', 'admin', 'member'
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, user_id)
);

-- Groups
CREATE TABLE groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, name)
);

-- Group Members
CREATE TABLE group_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- Workspaces
CREATE TABLE workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(organization_id, slug)
);

-- Maps
CREATE TABLE maps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    description TEXT,
    owner_id UUID REFERENCES users(id),
    git_repo_url TEXT,
    git_branch VARCHAR(100) DEFAULT 'main',
    yaml TEXT, -- Map YAML content
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(workspace_id, slug)
);

-- Components (stored in database for quick access, synced from YAML)
CREATE TABLE components (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    external_id VARCHAR(255) NOT NULL, -- ID from YAML
    name VARCHAR(255) NOT NULL,
    type VARCHAR(100) NOT NULL,
    config JSONB DEFAULT '{}'::jsonb,
    position JSONB DEFAULT '{"x": 0, "y": 0}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(map_id, external_id)
);

-- ============================================================================
-- PERMISSIONS
-- ============================================================================

-- Roles
CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(50) UNIQUE NOT NULL,  -- 'viewer', 'operator', 'editor', 'admin'
    description TEXT,
    permissions JSONB NOT NULL  -- Role permissions
);

-- Map Permissions (Users)
CREATE TABLE map_permissions_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    permission_overrides JSONB DEFAULT '{}'::jsonb,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    UNIQUE(map_id, user_id)
);

-- Map Permissions (Groups)
CREATE TABLE map_permissions_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    role_id UUID REFERENCES roles(id),
    permission_overrides JSONB DEFAULT '{}'::jsonb,
    granted_by UUID REFERENCES users(id),
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(map_id, group_id)
);

-- Map Share Links
CREATE TABLE map_share_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    token VARCHAR(64) UNIQUE NOT NULL,
    role_id UUID REFERENCES roles(id),
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ,
    password_hash VARCHAR(255),
    max_uses INTEGER,
    use_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true
);

-- ============================================================================
-- AGENTS & GATEWAYS
-- ============================================================================

-- Gateways
CREATE TABLE gateways (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    zone VARCHAR(100) NOT NULL,
    url TEXT NOT NULL,
    status VARCHAR(50) DEFAULT 'offline',
    last_heartbeat TIMESTAMPTZ,
    connected_agents INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agents
CREATE TABLE agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    gateway_id UUID REFERENCES gateways(id) ON DELETE SET NULL,
    hostname VARCHAR(255) NOT NULL,
    labels JSONB DEFAULT '{}'::jsonb,
    status VARCHAR(50) DEFAULT 'offline',
    last_heartbeat TIMESTAMPTZ,
    version VARCHAR(50),
    os VARCHAR(100),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Agent Snapshots (component assignments)
CREATE TABLE agent_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
    map_id UUID REFERENCES maps(id) ON DELETE CASCADE,
    components JSONB NOT NULL, -- List of component IDs
    checks JSONB NOT NULL, -- Check definitions
    commands JSONB NOT NULL, -- Command definitions
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(agent_id, map_id)
);

-- ============================================================================
-- JOBS & OPERATIONS
-- ============================================================================

-- Jobs
CREATE TABLE jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(50) NOT NULL, -- 'command', 'action', 'check'
    status VARCHAR(50) DEFAULT 'pending',
    map_id UUID REFERENCES maps(id) ON DELETE SET NULL,
    component_id UUID REFERENCES components(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
    command TEXT NOT NULL,
    args JSONB DEFAULT '[]'::jsonb,
    result JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID REFERENCES users(id)
);

-- Check Results (historical)
CREATE TABLE check_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    component_id UUID REFERENCES components(id) ON DELETE CASCADE,
    check_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL, -- 'ok', 'warning', 'error', 'unknown'
    message TEXT,
    metrics JSONB,
    duration_ms INTEGER,
    checked_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- AUDIT
-- ============================================================================

-- Audit Logs
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    action VARCHAR(255) NOT NULL,
    actor_type VARCHAR(50) NOT NULL, -- 'user', 'system', 'agent'
    actor_id UUID,
    actor_email VARCHAR(255),
    actor_ip VARCHAR(45),
    target_type VARCHAR(100) NOT NULL,
    target_id UUID,
    details JSONB DEFAULT '{}'::jsonb,
    organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE
);

-- ============================================================================
-- INDEXES
-- ============================================================================

-- Users
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_provider ON users(auth_provider, auth_provider_id);

-- Organization Members
CREATE INDEX idx_org_members_user ON organization_members(user_id);
CREATE INDEX idx_org_members_org ON organization_members(organization_id);

-- Groups
CREATE INDEX idx_groups_org ON groups(organization_id);

-- Group Members
CREATE INDEX idx_group_members_user ON group_members(user_id);

-- Workspaces
CREATE INDEX idx_workspaces_org ON workspaces(organization_id);

-- Maps
CREATE INDEX idx_maps_workspace ON maps(workspace_id);
CREATE INDEX idx_maps_owner ON maps(owner_id);

-- Components
CREATE INDEX idx_components_map ON components(map_id);

-- Permissions
CREATE INDEX idx_map_perm_users_map ON map_permissions_users(map_id);
CREATE INDEX idx_map_perm_users_user ON map_permissions_users(user_id);
CREATE INDEX idx_map_perm_groups_map ON map_permissions_groups(map_id);
CREATE INDEX idx_map_perm_groups_group ON map_permissions_groups(group_id);

-- Share Links
CREATE INDEX idx_share_links_map ON map_share_links(map_id);
CREATE INDEX idx_share_links_token ON map_share_links(token);

-- Agents
CREATE INDEX idx_agents_gateway ON agents(gateway_id);
CREATE INDEX idx_agents_status ON agents(status);
CREATE INDEX idx_agents_labels ON agents USING GIN(labels);

-- Jobs
CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_map ON jobs(map_id);
CREATE INDEX idx_jobs_agent ON jobs(agent_id);
CREATE INDEX idx_jobs_created ON jobs(created_at DESC);

-- Check Results
CREATE INDEX idx_check_results_component ON check_results(component_id);
CREATE INDEX idx_check_results_time ON check_results(checked_at DESC);

-- Audit Logs
CREATE INDEX idx_audit_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_time ON audit_logs(timestamp DESC);
CREATE INDEX idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX idx_audit_target ON audit_logs(target_type, target_id);

-- ============================================================================
-- INITIAL DATA
-- ============================================================================

-- Insert default roles
INSERT INTO roles (name, description, permissions) VALUES
('viewer', 'Read-only access', '{
    "map": ["view"],
    "component": ["view", "logs"],
    "action": []
}'::jsonb),
('operator', 'Operations access', '{
    "map": ["view"],
    "component": ["view", "start", "stop", "restart", "logs"],
    "action": ["execute"]
}'::jsonb),
('editor', 'Edit access', '{
    "map": ["view", "edit"],
    "component": ["view", "start", "stop", "restart", "logs", "edit"],
    "action": ["execute", "create", "edit", "delete"]
}'::jsonb),
('admin', 'Full access', '{
    "map": ["view", "edit", "delete", "share", "admin"],
    "component": ["*"],
    "action": ["*"]
}'::jsonb),
('restricted_operator', 'Limited operations (start only)', '{
    "map": ["view"],
    "component": ["view", "start", "logs"],
    "action": []
}'::jsonb);
