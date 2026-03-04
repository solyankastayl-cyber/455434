/**
 * S10.6 — Observation Storage Layer
 * 
 * MongoDB persistence for exchange observations.
 * Collection: exchange_observations
 * NO TTL — historical data has value
 */

import { MongoClient, Db, Collection, ObjectId } from 'mongodb';
import {
  ExchangeObservationRow,
  ObservationStats,
  ObservationQuery,
  RegimePatternMatrix,
  RegimeType,
} from './observation.types.js';
import { PatternCategory } from '../patterns/pattern.types.js';

// ═══════════════════════════════════════════════════════════════
// DATABASE CONNECTION
// ═══════════════════════════════════════════════════════════════

const MONGO_URL = process.env.MONGO_URL || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'intelligence_engine';
const COLLECTION_NAME = 'exchange_observations';

let db: Db | null = null;
let collection: Collection<ExchangeObservationRow> | null = null;

async function getCollection(): Promise<Collection<ExchangeObservationRow>> {
  if (collection) return collection;
  
  const client = new MongoClient(MONGO_URL);
  await client.connect();
  db = client.db(DB_NAME);
  collection = db.collection<ExchangeObservationRow>(COLLECTION_NAME);
  
  // Create indexes
  await collection.createIndex({ symbol: 1, timestamp: -1 });
  await collection.createIndex({ timestamp: -1 });
  await collection.createIndex({ 'regime.type': 1 });
  await collection.createIndex({ hasConflict: 1 });
  await collection.createIndex({ createdAt: -1 });
  // S10.6I.6 — Indicator indexes
  await collection.createIndex({ 'indicatorsMeta.completeness': -1 });
  await collection.createIndex({ 'indicatorsMeta.indicatorCount': -1 });
  
  console.log(`[S10.6] Connected to MongoDB, collection: ${COLLECTION_NAME}`);
  return collection;
}

// ═══════════════════════════════════════════════════════════════
// SAVE OBSERVATION
// ═══════════════════════════════════════════════════════════════

export async function saveObservation(row: ExchangeObservationRow): Promise<string> {
  const coll = await getCollection();
  
  // Remove _id if present to let MongoDB generate it
  const { id, ...rowWithoutId } = row;
  
  const result = await coll.insertOne({
    ...rowWithoutId,
    id: row.id,
  } as any);
  
  return result.insertedId.toString();
}

// ═══════════════════════════════════════════════════════════════
// GET OBSERVATIONS
// ═══════════════════════════════════════════════════════════════

export async function getObservations(query: ObservationQuery): Promise<ExchangeObservationRow[]> {
  const coll = await getCollection();
  
  const filter: any = {};
  
  if (query.symbol) {
    filter.symbol = query.symbol.toUpperCase();
  }
  
  if (query.startTime || query.endTime) {
    filter.timestamp = {};
    if (query.startTime) filter.timestamp.$gte = query.startTime;
    if (query.endTime) filter.timestamp.$lte = query.endTime;
  }
  
  if (query.regime) {
    filter['regime.type'] = query.regime;
  }
  
  if (query.hasPatterns !== undefined) {
    filter.patternCount = query.hasPatterns ? { $gt: 0 } : 0;
  }
  
  if (query.hasConflict !== undefined) {
    filter.hasConflict = query.hasConflict;
  }
  
  const limit = Math.min(query.limit || 100, 1000);
  const offset = query.offset || 0;
  
  const docs = await coll
    .find(filter, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .skip(offset)
    .limit(limit)
    .toArray();
  
  return docs;
}

// ═══════════════════════════════════════════════════════════════
// GET RECENT OBSERVATIONS
// ═══════════════════════════════════════════════════════════════

export async function getRecentObservations(
  symbol?: string,
  limit: number = 50
): Promise<ExchangeObservationRow[]> {
  return getObservations({
    symbol,
    limit,
  });
}

// ═══════════════════════════════════════════════════════════════
// GET STATS
// ═══════════════════════════════════════════════════════════════

export async function getStats(): Promise<ObservationStats> {
  const coll = await getCollection();
  
  // Total count
  const totalObservations = await coll.countDocuments();
  
  // Count by symbol
  const symbolAgg = await coll.aggregate([
    { $group: { _id: '$symbol', count: { $sum: 1 } } },
  ]).toArray();
  const observationsBySymbol: Record<string, number> = {};
  for (const item of symbolAgg) {
    observationsBySymbol[item._id] = item.count;
  }
  
  // Pattern frequency (flatten patterns array)
  const patternAgg = await coll.aggregate([
    { $unwind: '$patterns' },
    { $group: { _id: '$patterns.name', count: { $sum: 1 } } },
  ]).toArray();
  const patternFrequency: Record<string, number> = {};
  for (const item of patternAgg) {
    patternFrequency[item._id] = item.count;
  }
  
  // Category frequency
  const categoryAgg = await coll.aggregate([
    { $unwind: '$patterns' },
    { $group: { _id: '$patterns.category', count: { $sum: 1 } } },
  ]).toArray();
  const categoryFrequency: Record<PatternCategory, number> = {
    FLOW: 0, OI: 0, LIQUIDATION: 0, VOLUME: 0, STRUCTURE: 0,
  };
  for (const item of categoryAgg) {
    if (item._id in categoryFrequency) {
      categoryFrequency[item._id as PatternCategory] = item.count;
    }
  }
  
  // Regime distribution
  const regimeAgg = await coll.aggregate([
    { $group: { _id: '$regime.type', count: { $sum: 1 } } },
  ]).toArray();
  const regimeDistribution: Record<RegimeType, number> = {
    ACCUMULATION: 0, DISTRIBUTION: 0, LONG_SQUEEZE: 0,
    SHORT_SQUEEZE: 0, EXPANSION: 0, EXHAUSTION: 0, NEUTRAL: 0,
  };
  for (const item of regimeAgg) {
    if (item._id in regimeDistribution) {
      regimeDistribution[item._id as RegimeType] = item.count;
    }
  }
  
  // Conflict stats
  const conflictCount = await coll.countDocuments({ hasConflict: true });
  const conflictRate = totalObservations > 0 ? conflictCount / totalObservations : 0;
  
  // Time range
  const firstDoc = await coll.findOne({}, { sort: { timestamp: 1 }, projection: { timestamp: 1 } });
  const lastDoc = await coll.findOne({}, { sort: { timestamp: -1 }, projection: { timestamp: 1 } });
  
  // Rate calculation
  let observationsPerHour = 0;
  if (firstDoc && lastDoc && firstDoc.timestamp !== lastDoc.timestamp) {
    const hoursDiff = (lastDoc.timestamp - firstDoc.timestamp) / (1000 * 60 * 60);
    observationsPerHour = hoursDiff > 0 ? totalObservations / hoursDiff : 0;
  }
  
  return {
    totalObservations,
    observationsBySymbol,
    patternFrequency,
    categoryFrequency,
    regimeDistribution,
    conflictCount,
    conflictRate,
    firstObservation: firstDoc?.timestamp || null,
    lastObservation: lastDoc?.timestamp || null,
    observationsPerHour,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET REGIME × PATTERN MATRIX
// ═══════════════════════════════════════════════════════════════

export async function getRegimePatternMatrix(): Promise<RegimePatternMatrix> {
  const coll = await getCollection();
  
  const agg = await coll.aggregate([
    { $unwind: '$patterns' },
    { $group: {
      _id: { regime: '$regime.type', pattern: '$patterns.name' },
      count: { $sum: 1 },
    }},
  ]).toArray();
  
  const matrix: Record<RegimeType, Record<string, number>> = {
    ACCUMULATION: {}, DISTRIBUTION: {}, LONG_SQUEEZE: {},
    SHORT_SQUEEZE: {}, EXPANSION: {}, EXHAUSTION: {}, NEUTRAL: {},
  };
  
  let totalSamples = 0;
  for (const item of agg) {
    const regime = item._id.regime as RegimeType;
    const pattern = item._id.pattern as string;
    if (regime in matrix) {
      matrix[regime][pattern] = item.count;
      totalSamples += item.count;
    }
  }
  
  return { matrix, totalSamples };
}

// ═══════════════════════════════════════════════════════════════
// CLEAR DATA (Admin only)
// ═══════════════════════════════════════════════════════════════

export async function clearObservations(symbol?: string): Promise<number> {
  const coll = await getCollection();
  
  const filter = symbol ? { symbol: symbol.toUpperCase() } : {};
  const result = await coll.deleteMany(filter);
  
  console.log(`[S10.6] Cleared ${result.deletedCount} observations${symbol ? ` for ${symbol}` : ''}`);
  return result.deletedCount;
}

// ═══════════════════════════════════════════════════════════════
// GET COUNT
// ═══════════════════════════════════════════════════════════════

export async function getCount(symbol?: string): Promise<number> {
  const coll = await getCollection();
  const filter = symbol ? { symbol: symbol.toUpperCase() } : {};
  return coll.countDocuments(filter);
}

// ═══════════════════════════════════════════════════════════════
// S10.6I.6 — GET OBSERVATION BY ID
// ═══════════════════════════════════════════════════════════════

export async function getObservationById(id: string): Promise<ExchangeObservationRow | null> {
  const coll = await getCollection();
  const doc = await coll.findOne({ id }, { projection: { _id: 0 } });
  return doc;
}

// ═══════════════════════════════════════════════════════════════
// S10.6I.6 — INDICATOR COVERAGE STATS
// ═══════════════════════════════════════════════════════════════

export interface IndicatorCoverageStats {
  totalObservations: number;
  withIndicators: number;
  coverageRate: number;
  avgCompleteness: number;
  avgIndicatorCount: number;
}

export async function getIndicatorCoverageStats(symbol?: string): Promise<IndicatorCoverageStats> {
  const coll = await getCollection();
  
  const filter: any = {};
  if (symbol) {
    filter.symbol = symbol.toUpperCase();
  }
  
  const totalObservations = await coll.countDocuments(filter);
  
  // Count observations with indicators
  const withIndicatorsFilter = { 
    ...filter, 
    'indicatorsMeta.indicatorCount': { $gt: 0 } 
  };
  const withIndicators = await coll.countDocuments(withIndicatorsFilter);
  
  // Aggregate average completeness
  const aggResult = await coll.aggregate([
    { $match: { ...filter, 'indicatorsMeta.completeness': { $exists: true } } },
    {
      $group: {
        _id: null,
        avgCompleteness: { $avg: '$indicatorsMeta.completeness' },
        avgIndicatorCount: { $avg: '$indicatorsMeta.indicatorCount' },
      },
    },
  ]).toArray();
  
  const agg = aggResult[0] || { avgCompleteness: 0, avgIndicatorCount: 0 };
  
  return {
    totalObservations,
    withIndicators,
    coverageRate: totalObservations > 0 ? withIndicators / totalObservations : 0,
    avgCompleteness: agg.avgCompleteness || 0,
    avgIndicatorCount: agg.avgIndicatorCount || 0,
  };
}

console.log('[S10.6] Observation Storage module loaded (S10.6I.6 enabled)');
