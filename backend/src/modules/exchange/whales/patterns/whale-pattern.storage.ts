/**
 * S10.W Step 5 — Whale Pattern Storage
 * 
 * MongoDB persistence for whale patterns (for LABS analysis).
 */

import { getDb } from '../../../../db/mongodb.js';
import { v4 as uuidv4 } from 'uuid';
import {
  WhalePatternId,
  WhalePatternSnapshot,
  WhalePatternHistoryEntry,
  WhalePatternHistoryQuery,
} from './whale-pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTION
// ═══════════════════════════════════════════════════════════════

const COLLECTION = 'exchange_whale_patterns';

let indexesCreated = false;

export async function ensureWhalePatternIndexes(): Promise<void> {
  if (indexesCreated) return;
  
  const db = await getDb();
  
  await db.collection(COLLECTION).createIndexes([
    { key: { symbol: 1, timestamp: -1 } },
    { key: { patternId: 1, timestamp: -1 } },
    { key: { riskLevel: 1, timestamp: -1 } },
    { key: { timestamp: -1 } },
  ]);
  
  indexesCreated = true;
  console.log('[S10.W] Whale Pattern indexes created');
}

// ═══════════════════════════════════════════════════════════════
// SAVE OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Save pattern snapshot to history.
 * Called after each tick if patterns changed.
 */
export async function savePatternSnapshot(
  snapshot: WhalePatternSnapshot
): Promise<number> {
  if (snapshot.patterns.length === 0) return 0;
  
  const db = await getDb();
  
  const entries: WhalePatternHistoryEntry[] = snapshot.patterns.map(p => ({
    id: uuidv4(),
    symbol: snapshot.symbol,
    timestamp: snapshot.timestamp,
    patternId: p.patternId,
    riskScore: p.riskScore,
    riskLevel: p.riskLevel,
    active: p.active,
    dominantWhaleSide: p.dominantWhaleSide,
    stabilityTicks: p.stabilityTicks,
  }));
  
  const result = await db.collection(COLLECTION).insertMany(
    entries.map(e => ({
      ...e,
      _createdAt: new Date(),
    }))
  );
  
  return result.insertedCount;
}

// ═══════════════════════════════════════════════════════════════
// QUERY OPERATIONS
// ═══════════════════════════════════════════════════════════════

export async function getPatternHistory(
  query: WhalePatternHistoryQuery
): Promise<WhalePatternHistoryEntry[]> {
  const db = await getDb();
  
  const filter: Record<string, any> = {};
  if (query.symbol) filter.symbol = query.symbol;
  if (query.patternId) filter.patternId = query.patternId;
  if (query.riskLevel) filter.riskLevel = query.riskLevel;
  if (query.startTime || query.endTime) {
    filter.timestamp = {};
    if (query.startTime) filter.timestamp.$gte = query.startTime;
    if (query.endTime) filter.timestamp.$lte = query.endTime;
  }
  
  const docs = await db.collection(COLLECTION)
    .find(filter, { projection: { _id: 0, _createdAt: 0 } })
    .sort({ timestamp: -1 })
    .limit(query.limit ?? 1000)
    .toArray();
  
  return docs as WhalePatternHistoryEntry[];
}

export async function getActivePatterns(
  minRiskScore = 0.5,
  limit = 50
): Promise<WhalePatternHistoryEntry[]> {
  const db = await getDb();
  
  // Get most recent patterns with high risk
  const docs = await db.collection(COLLECTION)
    .find(
      { 
        riskScore: { $gte: minRiskScore },
        active: true,
      },
      { projection: { _id: 0, _createdAt: 0 } }
    )
    .sort({ timestamp: -1 })
    .limit(limit)
    .toArray();
  
  return docs as WhalePatternHistoryEntry[];
}

export async function getPatternStats(
  startTime: number,
  endTime: number
): Promise<{
  total: number;
  byPattern: Record<WhalePatternId, { count: number; avgRisk: number }>;
  byRiskLevel: Record<string, number>;
}> {
  const db = await getDb();
  
  const pipeline = [
    {
      $match: {
        timestamp: { $gte: startTime, $lte: endTime },
        active: true,
      },
    },
    {
      $group: {
        _id: '$patternId',
        count: { $sum: 1 },
        avgRisk: { $avg: '$riskScore' },
      },
    },
  ];
  
  const byPatternResults = await db.collection(COLLECTION)
    .aggregate(pipeline)
    .toArray();
  
  const byPattern: Record<string, { count: number; avgRisk: number }> = {};
  for (const r of byPatternResults) {
    byPattern[r._id] = { count: r.count, avgRisk: r.avgRisk };
  }
  
  // Count by risk level
  const riskLevelPipeline = [
    {
      $match: {
        timestamp: { $gte: startTime, $lte: endTime },
        active: true,
      },
    },
    {
      $group: {
        _id: '$riskLevel',
        count: { $sum: 1 },
      },
    },
  ];
  
  const riskResults = await db.collection(COLLECTION)
    .aggregate(riskLevelPipeline)
    .toArray();
  
  const byRiskLevel: Record<string, number> = {};
  for (const r of riskResults) {
    byRiskLevel[r._id] = r.count;
  }
  
  const total = Object.values(byRiskLevel).reduce((a, b) => a + b, 0);
  
  return {
    total,
    byPattern: byPattern as Record<WhalePatternId, { count: number; avgRisk: number }>,
    byRiskLevel,
  };
}

console.log('[S10.W] Whale Pattern Storage loaded');
