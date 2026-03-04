/**
 * WebSocket Gateway (P2.3)
 * 
 * Single WebSocket endpoint for all real-time events.
 * Features:
 * - Typed events (JSON)
 * - Subscription filtering
 * - Heartbeat (ping/pong)
 * - Auto-cleanup on disconnect
 */
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { eventBus, SystemEvent } from './event-bus.js';

// Subscription categories
type SubscriptionCategory = 'bootstrap' | 'resolver' | 'attribution' | 'alerts' | 'signals';

// Client connection state
interface WSClient {
  id: string;
  socket: WebSocket;
  subscriptions: Set<SubscriptionCategory>;
  lastPing: number;
}

// Active clients
const clients = new Map<string, WSClient>();

// Ping interval (30 seconds)
const PING_INTERVAL = 30_000;
const PING_TIMEOUT = 10_000;

let pingIntervalId: NodeJS.Timeout | null = null;

/**
 * Register WebSocket routes
 */
export async function registerWebSocket(app: FastifyInstance): Promise<void> {
  // WebSocket plugin is already registered in websocketPlugin
  // Register the WS endpoint with websocket: true option
  // Use /api/ws prefix for Kubernetes ingress routing
  
  app.get('/api/ws', { websocket: true }, (socket: any, request) => {
    // Check if socket.ws exists (older @fastify/websocket version behavior)
    const ws = socket?.on ? socket : socket?.ws;
    
    if (!ws || typeof ws?.on !== 'function') {
      console.error('[WS] ERROR: Invalid socket object received');
      return;
    }
    
    const clientId = generateClientId();
    const client: WSClient = {
      id: clientId,
      socket: ws,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };
    
    clients.set(clientId, client);
    console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);
    
    // Send welcome message
    sendToClient(client, {
      type: 'connected',
      clientId,
      timestamp: Date.now(),
    });
    
    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(client, message);
      } catch (err) {
        console.error('[WS] Invalid message:', err);
      }
    });
    
    // Handle pong
    ws.on('pong', () => {
      client.lastPing = Date.now();
    });
    
    // Handle close
    ws.on('close', () => {
      clients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId} (total: ${clients.size})`);
    });
    
    // Handle error
    ws.on('error', (err: Error) => {
      console.error(`[WS] Client error ${clientId}:`, err);
      clients.delete(clientId);
    });
  });
  
  // Start heartbeat
  startHeartbeat();
  
  // Subscribe to event bus
  eventBus.onAnyEvent(broadcastEvent);
  
  console.log('[WS] WebSocket gateway registered at /ws');
}

/**
 * Setup WebSocket Gateway (non-encapsulated version)
 * Call this AFTER websocket plugin is registered
 */
export function setupWebSocketGateway(app: FastifyInstance): void {
  // Register WebSocket route directly (not via app.register to avoid encapsulation)
  // Use /api/ws prefix for Kubernetes ingress routing
  app.get('/api/ws', { websocket: true }, (socket: any, request) => {
    const clientId = generateClientId();
    const client: WSClient = {
      id: clientId,
      socket: socket,
      subscriptions: new Set(),
      lastPing: Date.now(),
    };
    
    clients.set(clientId, client);
    console.log(`[WS] Client connected: ${clientId} (total: ${clients.size})`);
    
    // Send welcome message
    sendToClient(client, {
      type: 'connected',
      clientId,
      timestamp: Date.now(),
    });
    
    // Handle incoming messages
    socket.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        handleClientMessage(client, message);
      } catch (err) {
        console.error('[WS] Invalid message:', err);
      }
    });
    
    // Handle pong
    socket.on('pong', () => {
      client.lastPing = Date.now();
    });
    
    // Handle close
    socket.on('close', () => {
      clients.delete(clientId);
      console.log(`[WS] Client disconnected: ${clientId} (total: ${clients.size})`);
    });
    
    // Handle error
    socket.on('error', (err: Error) => {
      console.error(`[WS] Client error ${clientId}:`, err);
      clients.delete(clientId);
    });
  });
  
  // Start heartbeat
  startHeartbeat();
  
  // Subscribe to event bus
  eventBus.onAnyEvent(broadcastEvent);
  
  console.log('[WS] WebSocket gateway setup complete at /api/ws');
}

/**
 * Handle client messages
 */
function handleClientMessage(client: WSClient, message: any): void {
  switch (message.type) {
    case 'hello':
      // Set subscriptions
      if (Array.isArray(message.subscriptions)) {
        client.subscriptions = new Set(message.subscriptions);
        console.log(`[WS] Client ${client.id} subscribed to:`, [...client.subscriptions]);
      }
      break;
    
    case 'subscribe':
      if (message.category) {
        client.subscriptions.add(message.category);
      }
      break;
    
    case 'unsubscribe':
      if (message.category) {
        client.subscriptions.delete(message.category);
      }
      break;
    
    case 'ping':
      sendToClient(client, { type: 'pong', timestamp: Date.now() });
      break;
    
    default:
      console.warn(`[WS] Unknown message type: ${message.type}`);
  }
}

/**
 * Broadcast event to subscribed clients
 */
function broadcastEvent(event: SystemEvent): void {
  const category = getEventCategory(event.type);
  
  for (const client of clients.values()) {
    // Check if client is subscribed to this category
    if (client.subscriptions.has(category) || client.subscriptions.size === 0) {
      sendToClient(client, event);
    }
  }
}

/**
 * Get category from event type
 */
function getEventCategory(eventType: string): SubscriptionCategory {
  if (eventType.startsWith('bootstrap.')) return 'bootstrap';
  if (eventType.startsWith('resolver.')) return 'resolver';
  if (eventType.startsWith('attribution.')) return 'attribution';
  if (eventType.startsWith('alert.')) return 'alerts';
  if (eventType.startsWith('signal.')) return 'signals';
  return 'resolver'; // default
}

/**
 * Send message to client
 */
function sendToClient(client: WSClient, data: any): void {
  try {
    if (client.socket.readyState === 1) { // OPEN
      client.socket.send(JSON.stringify(data));
    }
  } catch (err) {
    console.error(`[WS] Send error to ${client.id}:`, err);
  }
}

/**
 * Start heartbeat to detect dead connections
 */
function startHeartbeat(): void {
  if (pingIntervalId) return;
  
  pingIntervalId = setInterval(() => {
    const now = Date.now();
    
    for (const [clientId, client] of clients) {
      // Check if client missed last ping
      if (now - client.lastPing > PING_INTERVAL + PING_TIMEOUT) {
        console.log(`[WS] Client ${clientId} timed out`);
        client.socket.terminate();
        clients.delete(clientId);
        continue;
      }
      
      // Send ping
      try {
        client.socket.ping();
      } catch (err) {
        console.error(`[WS] Ping error ${clientId}:`, err);
      }
    }
  }, PING_INTERVAL);
}

/**
 * Stop heartbeat
 */
export function stopHeartbeat(): void {
  if (pingIntervalId) {
    clearInterval(pingIntervalId);
    pingIntervalId = null;
  }
}

/**
 * Generate unique client ID
 */
function generateClientId(): string {
  return `ws_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Get connection stats
 */
export function getConnectionStats(): { total: number; subscriptions: Record<string, number> } {
  const subscriptions: Record<string, number> = {
    bootstrap: 0,
    resolver: 0,
    attribution: 0,
    alerts: 0,
    signals: 0,
  };
  
  for (const client of clients.values()) {
    for (const sub of client.subscriptions) {
      subscriptions[sub] = (subscriptions[sub] || 0) + 1;
    }
  }
  
  return {
    total: clients.size,
    subscriptions,
  };
}
