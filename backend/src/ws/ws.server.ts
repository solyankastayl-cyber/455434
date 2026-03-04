import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import type { WsClient, WsMessage, WsBroadcast } from './ws.types.js';

/**
 * WebSocket Server
 */

class WsServer {
  private clients: Map<string, WsClient> = new Map();

  /**
   * Add a new client
   */
  addClient(ws: WebSocket, userId?: string): WsClient {
    const client: WsClient = {
      id: randomUUID(),
      ws,
      subscriptions: new Set(),
      userId,
      connectedAt: new Date(),
    };
    this.clients.set(client.id, client);
    console.log(`[WS] Client connected: ${client.id}. Total: ${this.clients.size}`);
    return client;
  }

  /**
   * Remove a client
   */
  removeClient(clientId: string): void {
    this.clients.delete(clientId);
    console.log(`[WS] Client disconnected: ${clientId}. Total: ${this.clients.size}`);
  }

  /**
   * Subscribe client to channel
   */
  subscribe(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.add(channel);
      this.sendToClient(clientId, { type: 'subscribed', channel, payload: null, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Unsubscribe client from channel
   */
  unsubscribe(clientId: string, channel: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.subscriptions.delete(channel);
      this.sendToClient(clientId, { type: 'unsubscribed', channel, payload: null, timestamp: new Date().toISOString() });
    }
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: WsBroadcast): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Broadcast to all clients subscribed to channel
   */
  broadcast(channel: string, type: string, payload: unknown): void {
    const message: WsBroadcast = {
      type,
      channel,
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const client of this.clients.values()) {
      if (client.subscriptions.has(channel) && client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Broadcast to all connected clients
   */
  broadcastAll(type: string, payload: unknown): void {
    const message: WsBroadcast = {
      type,
      channel: 'global',
      payload,
      timestamp: new Date().toISOString(),
    };

    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        client.ws.send(JSON.stringify(message));
      }
    }
  }

  /**
   * Get connected clients count
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Handle incoming message
   */
  handleMessage(clientId: string, data: string): void {
    try {
      const message = JSON.parse(data) as WsMessage;

      switch (message.action) {
        case 'subscribe':
          if (message.channel) {
            this.subscribe(clientId, message.channel);
          }
          break;
        case 'unsubscribe':
          if (message.channel) {
            this.unsubscribe(clientId, message.channel);
          }
          break;
        case 'ping':
          this.sendToClient(clientId, { type: 'pong', channel: 'system', payload: null, timestamp: new Date().toISOString() });
          break;
        default:
          break;
      }
    } catch (err) {
      console.error('[WS] Invalid message:', err);
    }
  }
}

// Singleton instance
export const wsServer = new WsServer();

/**
 * Register WebSocket routes
 */
export async function wsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ws', { websocket: true }, (socket: any, request) => {
    const client = wsServer.addClient(socket);

    socket.on('message', (data: any) => {
      wsServer.handleMessage(client.id, data.toString());
    });

    socket.on('close', () => {
      wsServer.removeClient(client.id);
    });

    socket.on('error', (err: Error) => {
      console.error('[WS] Socket error:', err);
      wsServer.removeClient(client.id);
    });
  });
}
