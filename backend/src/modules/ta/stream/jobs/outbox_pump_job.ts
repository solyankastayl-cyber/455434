/**
 * Phase O: Outbox Pump Job
 * 
 * Delivers undelivered events from outbox to WebSocket subscribers
 */

import { Db } from 'mongodb';
import { EventBus } from '../event_bus.js';
import { fetchUndelivered, markDelivered, markAttempt } from '../outbox_store.js';
import { TAStreamEvent } from '../stream_types.js';

export interface PumpResult {
  ok: boolean;
  pumped: number;
  errors: number;
}

/**
 * Pump undelivered events from outbox to event bus
 */
export async function pumpOutbox(params: {
  db: Db;
  bus: EventBus;
  limit?: number;
}): Promise<PumpResult> {
  const { db, bus, limit = 200 } = params;
  
  let pumped = 0;
  let errors = 0;

  try {
    const items = await fetchUndelivered(db, limit);

    for (const item of items) {
      try {
        await markAttempt(db, item.id);

        const event: TAStreamEvent = {
          id: item.id,
          type: item.type,
          asset: item.asset,
          timeframe: item.timeframe,
          ts: item.ts,
          payload: item.payload,
        };

        bus.publish(event);
        await markDelivered(db, item.id);
        pumped++;
      } catch (err) {
        console.warn(`[OutboxPump] Failed to pump ${item.id}:`, err);
        errors++;
      }
    }
  } catch (err) {
    console.error('[OutboxPump] Failed to fetch undelivered:', err);
    errors++;
  }

  return { ok: errors === 0, pumped, errors };
}

/**
 * Create pump job function for scheduler
 */
export function createPumpJob(params: { db: Db; bus: EventBus }): () => Promise<PumpResult> {
  return () => pumpOutbox(params);
}
