import type { WebSocket } from 'ws';

/**
 * WebSocket Types
 */

export interface WsClient {
  id: string;
  ws: WebSocket;
  subscriptions: Set<string>;
  userId?: string;
  connectedAt: Date;
}

export interface WsMessage {
  action: 'subscribe' | 'unsubscribe' | 'ping' | 'pong';
  channel?: string;
  payload?: unknown;
}

export interface WsBroadcast {
  type: string;
  channel: string;
  payload: unknown;
  timestamp: string;
}

export type WsChannel =
  | 'signals'
  | 'transfers'
  | 'scores'
  | 'alerts'
  | 'market';
