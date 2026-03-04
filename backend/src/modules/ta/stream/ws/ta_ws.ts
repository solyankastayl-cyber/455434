/**
 * Phase O: WebSocket Handler for TA Streams
 * 
 * Real-time event streaming via WebSocket
 */

import type { FastifyInstance } from 'fastify';
import { EventBus } from '../event_bus.js';
import { TAStreamSubscription, TAStreamEvent, TAStreamEventType } from '../stream_types.js';

const ALL_TYPES: TAStreamEventType[] = [
  'DECISION', 'MTF_DECISION', 'REGIME_UPDATE', 
  'OUTCOME_UPDATE', 'CALIBRATION_UPDATE', 'ALERT'
];

/**
 * Check if event matches subscription
 */
function matchesSubscription(sub: TAStreamSubscription, event: TAStreamEvent): boolean {
  const assets = sub.assets ?? ['*'];
  const timeframes = sub.timeframes ?? ['*'];
  const types = sub.types ?? ALL_TYPES;

  const assetOk = assets.includes('*') || (event.asset && assets.includes(event.asset));
  const tfOk = timeframes.includes('*') || (event.timeframe && timeframes.includes(event.timeframe));
  const typeOk = types.includes(event.type);

  return assetOk && tfOk && typeOk;
}

/**
 * Register WebSocket endpoint for TA streams
 */
export async function registerTAWebSocket(
  app: FastifyInstance,
  deps: { bus: EventBus }
): Promise<void> {
  const { bus } = deps;

  // Track active connections
  let connectionCount = 0;

  app.get('/ws/ta', { websocket: true }, (connection) => {
    connectionCount++;
    console.log(`[WS] Client connected (total: ${connectionCount})`);

    // Default subscription: all events
    let subscription: TAStreamSubscription = {
      assets: ['*'],
      timeframes: ['*'],
      types: ALL_TYPES,
    };

    // Subscribe to event bus
    const unsubscribe = bus.subscribe((event) => {
      if (matchesSubscription(subscription, event)) {
        try {
          connection.socket.send(JSON.stringify(event));
        } catch (err) {
          console.warn('[WS] Send error:', err);
        }
      }
    });

    // Handle incoming messages (subscription updates)
    connection.socket.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        
        if (msg?.type === 'SUBSCRIBE' && msg.subscription) {
          subscription = {
            assets: msg.subscription.assets ?? ['*'],
            timeframes: msg.subscription.timeframes ?? ['*'],
            types: msg.subscription.types ?? ALL_TYPES,
          };
          
          // Send confirmation
          connection.socket.send(JSON.stringify({
            type: 'SUBSCRIBED',
            subscription,
            ts: Date.now(),
          }));
        }

        if (msg?.type === 'PING') {
          connection.socket.send(JSON.stringify({ type: 'PONG', ts: Date.now() }));
        }
      } catch (err) {
        // Ignore parse errors
      }
    });

    // Cleanup on close
    connection.socket.on('close', () => {
      unsubscribe();
      connectionCount--;
      console.log(`[WS] Client disconnected (total: ${connectionCount})`);
    });

    // Send welcome message
    connection.socket.send(JSON.stringify({
      type: 'CONNECTED',
      subscription,
      ts: Date.now(),
    }));
  });

  console.log('[WS] TA WebSocket registered at /ws/ta');
}

/**
 * Get WebSocket stats
 */
export function getWSStats(): { note: string } {
  return { note: 'Connection tracking available in runtime' };
}
