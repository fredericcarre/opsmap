import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { verifyToken, type JwtPayload } from '../auth/jwt.js';
import { createChildLogger } from '../config/logger.js';
import { permissionsRepository, mapsRepository } from '../db/repositories/index.js';

const logger = createChildLogger('websocket');

interface AuthenticatedWebSocket extends WebSocket {
  userId?: string;
  email?: string;
  isAlive?: boolean;
  subscriptions?: Set<string>; // map IDs the client is subscribed to
}

interface WebSocketMessage {
  type: string;
  payload?: unknown;
}

interface ComponentStatusUpdate {
  mapId: string;
  componentId: string;
  status: string;
  message?: string;
  timestamp: Date;
}

interface MapUpdate {
  mapId: string;
  type: 'component_status' | 'map_updated' | 'component_added' | 'component_removed';
  data: unknown;
}

export class OpsMapWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<string, Set<AuthenticatedWebSocket>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: Server) {
    this.wss = new WebSocketServer({
      server,
      path: '/ws',
      verifyClient: this.verifyClient.bind(this),
    });

    this.wss.on('connection', this.handleConnection.bind(this));
    this.wss.on('error', (error) => {
      logger.error({ error }, 'WebSocket server error');
    });

    // Start heartbeat
    this.heartbeatInterval = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        const client = ws as AuthenticatedWebSocket;
        if (client.isAlive === false) {
          logger.debug({ userId: client.userId }, 'Terminating inactive client');
          return client.terminate();
        }
        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    logger.info('WebSocket server initialized');
  }

  private verifyClient(
    info: { origin: string; req: { url?: string } },
    callback: (result: boolean, code?: number, message?: string) => void
  ): void {
    // Extract token from query string
    const url = new URL(info.req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      callback(false, 401, 'Missing authentication token');
      return;
    }

    try {
      verifyToken(token);
      callback(true);
    } catch {
      callback(false, 401, 'Invalid authentication token');
    }
  }

  private handleConnection(ws: WebSocket, req: { url?: string }): void {
    const client = ws as AuthenticatedWebSocket;

    // Extract and verify token
    const url = new URL(req.url || '', 'http://localhost');
    const token = url.searchParams.get('token');

    if (!token) {
      ws.close(1008, 'Missing authentication');
      return;
    }

    let payload: JwtPayload;
    try {
      payload = verifyToken(token);
    } catch {
      ws.close(1008, 'Invalid token');
      return;
    }

    client.userId = payload.sub;
    client.email = payload.email;
    client.isAlive = true;
    client.subscriptions = new Set();

    // Add to clients map
    if (!this.clients.has(payload.sub)) {
      this.clients.set(payload.sub, new Set());
    }
    this.clients.get(payload.sub)!.add(client);

    logger.info({ userId: payload.sub, email: payload.email }, 'Client connected');

    // Handle pong (heartbeat response)
    client.on('pong', () => {
      client.isAlive = true;
    });

    // Handle messages
    client.on('message', (data) => {
      this.handleMessage(client, data.toString());
    });

    // Handle close
    client.on('close', () => {
      this.handleDisconnect(client);
    });

    // Handle errors
    client.on('error', (error) => {
      logger.error({ userId: client.userId, error }, 'Client error');
    });

    // Send welcome message
    this.send(client, {
      type: 'connected',
      payload: { userId: payload.sub },
    });
  }

  private async handleMessage(client: AuthenticatedWebSocket, data: string): Promise<void> {
    let message: WebSocketMessage;

    try {
      message = JSON.parse(data);
    } catch {
      this.send(client, { type: 'error', payload: { message: 'Invalid JSON' } });
      return;
    }

    logger.debug({ userId: client.userId, type: message.type }, 'Received message');

    switch (message.type) {
      case 'subscribe':
        await this.handleSubscribe(client, message.payload as { mapId: string });
        break;

      case 'unsubscribe':
        this.handleUnsubscribe(client, message.payload as { mapId: string });
        break;

      case 'ping':
        this.send(client, { type: 'pong' });
        break;

      default:
        this.send(client, {
          type: 'error',
          payload: { message: `Unknown message type: ${message.type}` },
        });
    }
  }

  private async handleSubscribe(
    client: AuthenticatedWebSocket,
    payload: { mapId: string }
  ): Promise<void> {
    if (!payload?.mapId) {
      this.send(client, {
        type: 'error',
        payload: { message: 'mapId required' },
      });
      return;
    }

    // Check permission
    const result = await permissionsRepository.checkPermission(
      client.userId!,
      payload.mapId,
      'map:view'
    );

    if (!result.allowed) {
      this.send(client, {
        type: 'subscribe_error',
        payload: { mapId: payload.mapId, message: 'Access denied' },
      });
      return;
    }

    client.subscriptions!.add(payload.mapId);

    this.send(client, {
      type: 'subscribed',
      payload: { mapId: payload.mapId },
    });

    logger.debug({ userId: client.userId, mapId: payload.mapId }, 'Client subscribed to map');
  }

  private handleUnsubscribe(
    client: AuthenticatedWebSocket,
    payload: { mapId: string }
  ): void {
    if (!payload?.mapId) {
      return;
    }

    client.subscriptions!.delete(payload.mapId);

    this.send(client, {
      type: 'unsubscribed',
      payload: { mapId: payload.mapId },
    });

    logger.debug({ userId: client.userId, mapId: payload.mapId }, 'Client unsubscribed from map');
  }

  private handleDisconnect(client: AuthenticatedWebSocket): void {
    if (client.userId) {
      const userClients = this.clients.get(client.userId);
      if (userClients) {
        userClients.delete(client);
        if (userClients.size === 0) {
          this.clients.delete(client.userId);
        }
      }
    }

    logger.info({ userId: client.userId }, 'Client disconnected');
  }

  private send(client: AuthenticatedWebSocket, message: WebSocketMessage): void {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(message));
    }
  }

  // Public methods for broadcasting

  /**
   * Broadcast an update to all clients subscribed to a map
   */
  public broadcastToMap(mapId: string, update: MapUpdate): void {
    let count = 0;

    this.wss.clients.forEach((ws) => {
      const client = ws as AuthenticatedWebSocket;
      if (client.subscriptions?.has(mapId) && client.readyState === WebSocket.OPEN) {
        this.send(client, {
          type: 'map_update',
          payload: update,
        });
        count++;
      }
    });

    logger.debug({ mapId, clientCount: count, updateType: update.type }, 'Broadcast to map');
  }

  /**
   * Send a component status update
   */
  public sendComponentStatus(update: ComponentStatusUpdate): void {
    this.broadcastToMap(update.mapId, {
      mapId: update.mapId,
      type: 'component_status',
      data: {
        componentId: update.componentId,
        status: update.status,
        message: update.message,
        timestamp: update.timestamp,
      },
    });
  }

  /**
   * Send to a specific user
   */
  public sendToUser(userId: string, message: WebSocketMessage): void {
    const userClients = this.clients.get(userId);
    if (userClients) {
      userClients.forEach((client) => {
        this.send(client, message);
      });
    }
  }

  /**
   * Broadcast to all connected clients
   */
  public broadcast(message: WebSocketMessage): void {
    this.wss.clients.forEach((ws) => {
      const client = ws as AuthenticatedWebSocket;
      if (client.readyState === WebSocket.OPEN) {
        this.send(client, message);
      }
    });
  }

  /**
   * Get connection stats
   */
  public getStats(): { totalConnections: number; uniqueUsers: number } {
    return {
      totalConnections: this.wss.clients.size,
      uniqueUsers: this.clients.size,
    };
  }

  /**
   * Close the WebSocket server
   */
  public close(): Promise<void> {
    return new Promise((resolve) => {
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
      }

      this.wss.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });
    });
  }
}

// Singleton instance
let wsServer: OpsMapWebSocketServer | null = null;

export function initWebSocketServer(server: Server): OpsMapWebSocketServer {
  if (wsServer) {
    return wsServer;
  }
  wsServer = new OpsMapWebSocketServer(server);
  return wsServer;
}

export function getWebSocketServer(): OpsMapWebSocketServer | null {
  return wsServer;
}
