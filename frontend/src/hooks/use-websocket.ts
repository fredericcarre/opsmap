import { useEffect, useRef, useState, useCallback } from 'react';
import { useAuthStore } from '@/stores/auth';
import type { ComponentStatus, WsMessage } from '@/types';

interface UseWebSocketReturn {
  isConnected: boolean;
  componentStatuses: Record<string, ComponentStatus>;
  sendMessage: (message: WsMessage) => void;
}

export function useWebSocket(mapId: string): UseWebSocketReturn {
  const token = useAuthStore((state) => state.token);
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [componentStatuses, setComponentStatuses] = useState<Record<string, ComponentStatus>>({});
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();

  const connect = useCallback(() => {
    if (!token || !mapId) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${token}`;

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Subscribe to map updates
      ws.send(JSON.stringify({ type: 'subscribe', payload: { mapId } }));
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WsMessage;

        switch (message.type) {
          case 'map_update': {
            const payload = message.payload as {
              type: string;
              data: {
                componentId: string;
                status: ComponentStatus;
              };
            };
            if (payload.type === 'component_status') {
              setComponentStatuses((prev) => ({
                ...prev,
                [payload.data.componentId]: payload.data.status,
              }));
            }
            break;
          }
          case 'error':
            console.error('WebSocket error:', message.payload);
            break;
        }
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Attempt to reconnect after 5 seconds
      reconnectTimeoutRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }, [token, mapId]);

  useEffect(() => {
    connect();

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        // Unsubscribe before closing
        if (wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({ type: 'unsubscribe', payload: { mapId } })
          );
        }
        wsRef.current.close();
      }
    };
  }, [connect, mapId]);

  const sendMessage = useCallback((message: WsMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  return {
    isConnected,
    componentStatuses,
    sendMessage,
  };
}
