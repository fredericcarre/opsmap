// Gateway Protocol Types

export interface GatewayRegistration {
  gateway_id: string;
  zone: string;
  version: string;
  agents: AgentInfo[];
}

export interface AgentInfo {
  id: string;
  hostname: string;
  labels: Record<string, string>;
  version: string;
  os: string;
  connected_at: string;
  last_heartbeat: string;
}

// Messages from Gateway to Backend
export type GatewayToBackendMessage =
  | { type: 'register'; payload: GatewayRegistration }
  | { type: 'agent_connected'; payload: AgentInfo }
  | { type: 'agent_disconnected'; payload: { agent_id: string } }
  | { type: 'status_update'; payload: StatusUpdate }
  | { type: 'command_response'; payload: CommandResponse }
  | { type: 'pong' };

export interface StatusUpdate {
  agent_id: string;
  component_id?: string;
  check_name?: string;
  status: 'ok' | 'warning' | 'error' | 'unknown';
  message?: string;
  metrics?: Record<string, number>;
  timestamp: string;
}

export interface CommandResponse {
  job_id: string;
  agent_id: string;
  status: 'started' | 'completed' | 'failed' | 'timeout';
  result?: {
    exit_code: number;
    stdout: string;
    stderr: string;
    duration_ms: number;
    timed_out: boolean;
  };
  error?: string;
  timestamp: string;
}

// Messages from Backend to Gateway
export type BackendToGatewayMessage =
  | { type: 'command'; payload: CommandPayload }
  | { type: 'snapshot'; payload: SnapshotPayload }
  | { type: 'ping' };

export interface CommandPayload {
  job_id: string;
  agent_id?: string;
  labels?: Record<string, string>;
  command: AgentCommand;
}

export interface AgentCommand {
  id: string;
  command_type: 'sync' | 'async';
  name: string;
  args: Record<string, unknown>;
  timeout_secs: number;
}

export interface SnapshotPayload {
  agent_id: string;
  snapshot: {
    components: SnapshotComponent[];
  };
}

export interface SnapshotComponent {
  id: string;
  external_id: string;
  checks: SnapshotCheck[];
  actions: SnapshotAction[];
}

export interface SnapshotCheck {
  name: string;
  type: string;
  config: Record<string, unknown>;
  interval_secs: number;
  timeout_secs: number;
}

export interface SnapshotAction {
  name: string;
  command: string;
  args: string[];
  run_as_user?: string;
  async: boolean;
  timeout_secs: number;
}
