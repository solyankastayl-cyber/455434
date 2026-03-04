/**
 * Admin Event Bus - STEP 0.5
 * 
 * WebSocket events для админки.
 * Только типы событий, без тяжёлых payload.
 */

import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';

// ============================================
// EVENT TYPES
// ============================================
export type AdminEventType =
  | 'ML_STATUS_CHANGED'
  | 'RETRAIN_STARTED'
  | 'RETRAIN_FINISHED'
  | 'PROVIDER_COOLDOWN'
  | 'DRIFT_DETECTED'
  | 'SETTINGS_CHANGED'
  | 'CIRCUIT_BREAKER_OPENED'
  | 'CIRCUIT_BREAKER_CLOSED';

export interface AdminEvent {
  type: AdminEventType;
  meta?: {
    network?: string;
    policyId?: string;
    providerId?: string;
    severity?: string;
  };
  timestamp: number;
}

// ============================================
// CONNECTED ADMIN CLIENTS
// ============================================
interface AdminWSClient {
  id: string;
  socket: WebSocket;
  lastPing: number;
}

const adminClients = new Map<string, AdminWSClient>();

// ============================================
// BROADCAST TO ADMIN CLIENTS
// ============================================
export function broadcastAdminEvent(event: AdminEvent): void {
  const message = JSON.stringify(event);
  let sent = 0;
  
  for (const [id, client] of adminClients) {
    try {
      if (client.socket.readyState === 1) { // OPEN
        client.socket.send(message);
        sent++;
      }
    } catch (err) {
      console.error(`[AdminWS] Failed to send to ${id}:`, err);
    }
  }
  
  if (sent > 0) {
    console.log(`[AdminWS] Broadcast ${event.type} to ${sent} clients`);
  }
}

// ============================================
// EMIT HELPERS (use from anywhere in backend)
// ============================================
export function emitMLStatusChanged(): void {
  broadcastAdminEvent({
    type: 'ML_STATUS_CHANGED',
    timestamp: Date.now(),
  });
}

export function emitRetrainStarted(policyId: string): void {
  broadcastAdminEvent({
    type: 'RETRAIN_STARTED',
    meta: { policyId },
    timestamp: Date.now(),
  });
}

export function emitRetrainFinished(policyId: string): void {
  broadcastAdminEvent({
    type: 'RETRAIN_FINISHED',
    meta: { policyId },
    timestamp: Date.now(),
  });
}

export function emitProviderCooldown(providerId: string): void {
  broadcastAdminEvent({
    type: 'PROVIDER_COOLDOWN',
    meta: { providerId },
    timestamp: Date.now(),
  });
}

export function emitDriftDetected(network: string, severity: string): void {
  broadcastAdminEvent({
    type: 'DRIFT_DETECTED',
    meta: { network, severity },
    timestamp: Date.now(),
  });
}

export function emitSettingsChanged(): void {
  broadcastAdminEvent({
    type: 'SETTINGS_CHANGED',
    timestamp: Date.now(),
  });
}

export function emitCircuitBreakerOpened(): void {
  broadcastAdminEvent({
    type: 'CIRCUIT_BREAKER_OPENED',
    timestamp: Date.now(),
  });
}

export function emitCircuitBreakerClosed(): void {
  broadcastAdminEvent({
    type: 'CIRCUIT_BREAKER_CLOSED',
    timestamp: Date.now(),
  });
}

// ============================================
// REGISTER WEBSOCKET ENDPOINT
// ============================================
let pingIntervalId: NodeJS.Timeout | null = null;

function generateClientId(): string {
  return `admin_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

export async function registerAdminWebSocket(app: FastifyInstance): Promise<void> {
  
  app.get('/ws/admin', { websocket: true }, (socket: any, request) => {
    const ws = socket?.on ? socket : socket?.ws;
    
    if (!ws || typeof ws?.on !== 'function') {
      console.error('[AdminWS] Invalid socket');
      return;
    }
    
    const clientId = generateClientId();
    const client: AdminWSClient = {
      id: clientId,
      socket: ws,
      lastPing: Date.now(),
    };
    
    adminClients.set(clientId, client);
    console.log(`[AdminWS] Client connected: ${clientId} (total: ${adminClients.size})`);
    
    // Send welcome
    ws.send(JSON.stringify({
      type: 'connected',
      clientId,
      timestamp: Date.now(),
    }));
    
    // Handle messages (ping/pong only)
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'ping') {
          client.lastPing = Date.now();
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
        }
      } catch (err) {
        // ignore invalid messages
      }
    });
    
    // Handle pong
    ws.on('pong', () => {
      client.lastPing = Date.now();
    });
    
    // Handle close
    ws.on('close', () => {
      adminClients.delete(clientId);
      console.log(`[AdminWS] Client disconnected: ${clientId} (total: ${adminClients.size})`);
    });
    
    // Handle error
    ws.on('error', (err: Error) => {
      console.error(`[AdminWS] Error for ${clientId}:`, err.message);
      adminClients.delete(clientId);
    });
  });
  
  // Start ping interval
  if (!pingIntervalId) {
    pingIntervalId = setInterval(() => {
      const now = Date.now();
      for (const [id, client] of adminClients) {
        try {
          if (now - client.lastPing > 60000) {
            client.socket.close();
            adminClients.delete(id);
          } else if (client.socket.readyState === 1) {
            client.socket.ping();
          }
        } catch (err) {
          adminClients.delete(id);
        }
      }
    }, 30000);
  }
  
  console.log('[AdminWS] WebSocket endpoint registered at /ws/admin');
}

// ============================================
// GET CONNECTED CLIENTS COUNT
// ============================================
export function getAdminWSClientCount(): number {
  return adminClients.size;
}

export default {
  broadcastAdminEvent,
  emitMLStatusChanged,
  emitRetrainStarted,
  emitRetrainFinished,
  emitProviderCooldown,
  emitDriftDetected,
  emitSettingsChanged,
  emitCircuitBreakerOpened,
  emitCircuitBreakerClosed,
  registerAdminWebSocket,
  getAdminWSClientCount,
};
