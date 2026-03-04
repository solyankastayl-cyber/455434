/**
 * S10.W — Whale Storage Service
 * 
 * MongoDB persistence for whale data:
 * - exchange_whale_snapshots
 * - exchange_whale_events
 * - exchange_whale_state
 * - exchange_whale_health
 * 
 * NO SIGNALS, NO PREDICTIONS — only data storage.
 */

import { getDb } from '../../../db/mongodb.js';
import { ObjectId } from 'mongodb';
import {
  LargePositionSnapshot,
  WhaleEvent,
  WhaleMarketState,
  WhaleSourceHealth,
  WhaleSnapshotQuery,
  WhaleEventQuery,
  WhaleStateQuery,
  ExchangeId,
} from './whale.types.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTION NAMES
// ═══════════════════════════════════════════════════════════════

const COLLECTIONS = {
  SNAPSHOTS: 'exchange_whale_snapshots',
  EVENTS: 'exchange_whale_events',
  STATE: 'exchange_whale_state',
  HEALTH: 'exchange_whale_health',
} as const;

// ═══════════════════════════════════════════════════════════════
// INDEX CREATION
// ═══════════════════════════════════════════════════════════════

let indexesCreated = false;

export async function ensureWhaleIndexes(): Promise<void> {
  if (indexesCreated) return;
  
  const db = await getDb();
  
  // Snapshots indexes
  await db.collection(COLLECTIONS.SNAPSHOTS).createIndexes([
    { key: { exchange: 1, symbol: 1, lastSeenTimestamp: -1 } },
    { key: { sizeUsd: -1 } },
    { key: { side: 1 } },
    { key: { wallet: 1 }, sparse: true },
  ]);
  
  // Events indexes
  await db.collection(COLLECTIONS.EVENTS).createIndexes([
    { key: { exchange: 1, symbol: 1, timestamp: -1 } },
    { key: { eventType: 1 } },
    { key: { timestamp: -1 } },
  ]);
  
  // State indexes
  await db.collection(COLLECTIONS.STATE).createIndexes([
    { key: { exchange: 1, symbol: 1, timestamp: -1 } },
    { key: { timestamp: -1 } },
  ]);
  
  // Health indexes
  await db.collection(COLLECTIONS.HEALTH).createIndexes([
    { key: { exchange: 1 }, unique: true },
  ]);
  
  indexesCreated = true;
  console.log('[S10.W] Whale indexes created');
}

// ═══════════════════════════════════════════════════════════════
// SNAPSHOT OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function saveSnapshot(snapshot: LargePositionSnapshot): Promise<string> {
  const db = await getDb();
  const result = await db.collection(COLLECTIONS.SNAPSHOTS).insertOne({
    ...snapshot,
    _createdAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function saveSnapshots(snapshots: LargePositionSnapshot[]): Promise<number> {
  if (snapshots.length === 0) return 0;
  
  const db = await getDb();
  const docs = snapshots.map(s => ({
    ...s,
    _createdAt: new Date(),
  }));
  
  const result = await db.collection(COLLECTIONS.SNAPSHOTS).insertMany(docs);
  return result.insertedCount;
}

export async function getSnapshots(query: WhaleSnapshotQuery): Promise<LargePositionSnapshot[]> {
  const db = await getDb();
  
  const filter: Record<string, any> = {};
  if (query.exchange) filter.exchange = query.exchange;
  if (query.symbol) filter.symbol = query.symbol;
  if (query.side) filter.side = query.side;
  if (query.minSizeUsd) filter.sizeUsd = { $gte: query.minSizeUsd };
  if (query.startTime || query.endTime) {
    filter.lastSeenTimestamp = {};
    if (query.startTime) filter.lastSeenTimestamp.$gte = query.startTime;
    if (query.endTime) filter.lastSeenTimestamp.$lte = query.endTime;
  }
  
  const docs = await db.collection(COLLECTIONS.SNAPSHOTS)
    .find(filter, { projection: { _id: 0, _createdAt: 0 } })
    .sort({ lastSeenTimestamp: -1 })
    .limit(query.limit ?? 100)
    .toArray();
  
  return docs as LargePositionSnapshot[];
}

export async function getLatestSnapshots(
  exchange: ExchangeId,
  symbol: string,
  limit = 50
): Promise<LargePositionSnapshot[]> {
  const db = await getDb();
  
  const docs = await db.collection(COLLECTIONS.SNAPSHOTS)
    .find(
      { exchange, symbol },
      { projection: { _id: 0, _createdAt: 0 } }
    )
    .sort({ lastSeenTimestamp: -1 })
    .limit(limit)
    .toArray();
  
  return docs as LargePositionSnapshot[];
}

// ═══════════════════════════════════════════════════════════════
// EVENT OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function saveEvent(event: WhaleEvent): Promise<string> {
  const db = await getDb();
  const result = await db.collection(COLLECTIONS.EVENTS).insertOne({
    ...event,
    _createdAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function saveEvents(events: WhaleEvent[]): Promise<number> {
  if (events.length === 0) return 0;
  
  const db = await getDb();
  const docs = events.map(e => ({
    ...e,
    _createdAt: new Date(),
  }));
  
  const result = await db.collection(COLLECTIONS.EVENTS).insertMany(docs);
  return result.insertedCount;
}

export async function getEvents(query: WhaleEventQuery): Promise<WhaleEvent[]> {
  const db = await getDb();
  
  const filter: Record<string, any> = {};
  if (query.exchange) filter.exchange = query.exchange;
  if (query.symbol) filter.symbol = query.symbol;
  if (query.eventType) filter.eventType = query.eventType;
  if (query.startTime || query.endTime) {
    filter.timestamp = {};
    if (query.startTime) filter.timestamp.$gte = query.startTime;
    if (query.endTime) filter.timestamp.$lte = query.endTime;
  }
  
  const docs = await db.collection(COLLECTIONS.EVENTS)
    .find(filter, { projection: { _id: 0, _createdAt: 0 } })
    .sort({ timestamp: -1 })
    .limit(query.limit ?? 100)
    .toArray();
  
  return docs as WhaleEvent[];
}

// ═══════════════════════════════════════════════════════════════
// STATE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function saveState(state: WhaleMarketState): Promise<string> {
  const db = await getDb();
  const result = await db.collection(COLLECTIONS.STATE).insertOne({
    ...state,
    _createdAt: new Date(),
  });
  return result.insertedId.toString();
}

export async function getLatestState(
  exchange: ExchangeId,
  symbol: string
): Promise<WhaleMarketState | null> {
  const db = await getDb();
  
  const doc = await db.collection(COLLECTIONS.STATE)
    .findOne(
      { exchange, symbol },
      { 
        projection: { _id: 0, _createdAt: 0 },
        sort: { timestamp: -1 },
      }
    );
  
  return doc as WhaleMarketState | null;
}

export async function getStateHistory(query: WhaleStateQuery): Promise<WhaleMarketState[]> {
  const db = await getDb();
  
  const filter: Record<string, any> = {};
  if (query.exchange) filter.exchange = query.exchange;
  if (query.symbol) filter.symbol = query.symbol;
  if (query.startTime || query.endTime) {
    filter.timestamp = {};
    if (query.startTime) filter.timestamp.$gte = query.startTime;
    if (query.endTime) filter.timestamp.$lte = query.endTime;
  }
  
  const docs = await db.collection(COLLECTIONS.STATE)
    .find(filter, { projection: { _id: 0, _createdAt: 0 } })
    .sort({ timestamp: -1 })
    .limit(query.limit ?? 100)
    .toArray();
  
  return docs as WhaleMarketState[];
}

// ═══════════════════════════════════════════════════════════════
// HEALTH OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function saveHealth(health: WhaleSourceHealth): Promise<void> {
  const db = await getDb();
  
  await db.collection(COLLECTIONS.HEALTH).updateOne(
    { exchange: health.exchange },
    { 
      $set: {
        ...health,
        _updatedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

export async function getHealth(exchange: ExchangeId): Promise<WhaleSourceHealth | null> {
  const db = await getDb();
  
  const doc = await db.collection(COLLECTIONS.HEALTH)
    .findOne(
      { exchange },
      { projection: { _id: 0, _updatedAt: 0 } }
    );
  
  return doc as WhaleSourceHealth | null;
}

export async function getAllHealth(): Promise<WhaleSourceHealth[]> {
  const db = await getDb();
  
  const docs = await db.collection(COLLECTIONS.HEALTH)
    .find({}, { projection: { _id: 0, _updatedAt: 0 } })
    .toArray();
  
  return docs as WhaleSourceHealth[];
}

// ═══════════════════════════════════════════════════════════════
// UTILITY OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function clearAllWhaleData(): Promise<{ deleted: number }> {
  const db = await getDb();
  
  const results = await Promise.all([
    db.collection(COLLECTIONS.SNAPSHOTS).deleteMany({}),
    db.collection(COLLECTIONS.EVENTS).deleteMany({}),
    db.collection(COLLECTIONS.STATE).deleteMany({}),
    db.collection(COLLECTIONS.HEALTH).deleteMany({}),
  ]);
  
  const deleted = results.reduce((sum, r) => sum + r.deletedCount, 0);
  return { deleted };
}

export async function getWhaleStats(): Promise<{
  snapshotCount: number;
  eventCount: number;
  stateCount: number;
  exchangesCovered: ExchangeId[];
  symbolsCovered: string[];
}> {
  const db = await getDb();
  
  const [snapshotCount, eventCount, stateCount, exchanges, symbols] = await Promise.all([
    db.collection(COLLECTIONS.SNAPSHOTS).countDocuments(),
    db.collection(COLLECTIONS.EVENTS).countDocuments(),
    db.collection(COLLECTIONS.STATE).countDocuments(),
    db.collection(COLLECTIONS.SNAPSHOTS).distinct('exchange'),
    db.collection(COLLECTIONS.SNAPSHOTS).distinct('symbol'),
  ]);
  
  return {
    snapshotCount,
    eventCount,
    stateCount,
    exchangesCovered: exchanges as ExchangeId[],
    symbolsCovered: symbols as string[],
  };
}

console.log('[S10.W] Whale Storage Service loaded');
