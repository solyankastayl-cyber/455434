/**
 * Phase O: Outbox Store
 * 
 * MongoDB-backed outbox for reliable event delivery
 */

import { Db } from 'mongodb';
import { TAStreamEvent, OutboxEventDoc } from './stream_types.js';

/**
 * Insert event into outbox
 */
export async function insertOutbox(db: Db, event: TAStreamEvent): Promise<void> {
  const doc: OutboxEventDoc = {
    ...event,
    createdAt: new Date(),
    delivered: false,
    deliveredAt: null,
    attempts: 0,
  };
  
  await db.collection('ta_outbox_events').insertOne(doc);
}

/**
 * Fetch undelivered events
 */
export async function fetchUndelivered(db: Db, limit = 200): Promise<OutboxEventDoc[]> {
  return await db.collection('ta_outbox_events')
    .find({ delivered: false })
    .sort({ ts: 1 })
    .limit(limit)
    .toArray() as OutboxEventDoc[];
}

/**
 * Mark event as delivered
 */
export async function markDelivered(db: Db, id: string): Promise<void> {
  await db.collection('ta_outbox_events').updateOne(
    { id },
    { $set: { delivered: true, deliveredAt: new Date() } }
  );
}

/**
 * Mark delivery attempt
 */
export async function markAttempt(db: Db, id: string): Promise<void> {
  await db.collection('ta_outbox_events').updateOne(
    { id },
    { $inc: { attempts: 1 } }
  );
}

/**
 * Get outbox stats
 */
export async function getOutboxStats(db: Db): Promise<{
  pending: number;
  delivered: number;
  total: number;
  oldestPending: Date | null;
}> {
  const pending = await db.collection('ta_outbox_events')
    .countDocuments({ delivered: false });
  
  const delivered = await db.collection('ta_outbox_events')
    .countDocuments({ delivered: true });

  const oldest = await db.collection('ta_outbox_events')
    .findOne({ delivered: false }, { sort: { ts: 1 } });

  return {
    pending,
    delivered,
    total: pending + delivered,
    oldestPending: oldest?.createdAt || null,
  };
}

/**
 * Cleanup old delivered events
 */
export async function cleanupDelivered(db: Db, olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  
  const result = await db.collection('ta_outbox_events').deleteMany({
    delivered: true,
    deliveredAt: { $lt: cutoff },
  });

  return result.deletedCount;
}

/**
 * Initialize outbox indexes
 */
export async function initOutboxIndexes(db: Db): Promise<void> {
  try {
    await db.collection('ta_outbox_events').createIndex(
      { id: 1 },
      { unique: true, background: true }
    );
    await db.collection('ta_outbox_events').createIndex(
      { delivered: 1, ts: 1 },
      { background: true }
    );
    await db.collection('ta_outbox_events').createIndex(
      { asset: 1, type: 1, ts: -1 },
      { background: true }
    );
    console.log('[Outbox] Indexes initialized');
  } catch (err) {
    console.error('[Outbox] Failed to create indexes:', err);
  }
}
