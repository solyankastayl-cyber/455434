/**
 * Phase 5: Dataset Writer v2
 * 
 * Writes ML dataset rows to MongoDB and exports to CSV/Parquet.
 * Supports batch operations for simulation replay.
 */

import { v4 as uuid } from 'uuid';
import { 
  MLFeaturesV2, 
  MLDatasetRowV2, 
  getCSVHeader, 
  rowToCSV,
  getFeatureNamesV2,
  featuresToArray,
} from './feature_schema_v2.js';
import { getDb } from '../../../db/mongodb.js';
import { logger } from '../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════

const COLLECTION_NAME = 'ta_ml_rows_v2';

async function getCollection() {
  const db = await getDb();
  return db.collection(COLLECTION_NAME);
}

// ═══════════════════════════════════════════════════════════════
// WRITE OPERATIONS
// ═══════════════════════════════════════════════════════════════

export interface WriteRowInputV2 {
  runId: string;
  scenarioId: string;
  symbol: string;
  timeframe: string;
  timestamp: number;
  features: MLFeaturesV2;
  labels: {
    winLoss: number;
    rMultiple: number;
    mfePct: number;
    maePct: number;
    barsInTrade: number;
  };
  meta: {
    patternType: string;
    patternFamily: string;
    entryPrice: number;
    stopPrice: number;
    target1Price: number;
    target2Price?: number;
    exitPrice: number;
    exitReason: string;
    side: 'LONG' | 'SHORT';
    regime: string;
    volatilityRegime: string;
  };
}

/**
 * Write single dataset row
 */
export async function writeDatasetRowV2(input: WriteRowInputV2): Promise<string> {
  const collection = await getCollection();
  
  const row: MLDatasetRowV2 = {
    rowId: uuid(),
    runId: input.runId,
    scenarioId: input.scenarioId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    timestamp: input.timestamp,
    schemaVersion: 'v2',
    features: input.features,
    labels: input.labels,
    meta: input.meta,
    createdAt: Date.now(),
  };
  
  await collection.insertOne(row);
  
  logger.info({
    phase: 'dataset_v2',
    rowId: row.rowId,
    symbol: row.symbol,
    label: row.labels.winLoss,
  }, 'Dataset row v2 written');
  
  return row.rowId;
}

/**
 * Write batch of dataset rows
 */
export async function writeDatasetRowsBatch(inputs: WriteRowInputV2[]): Promise<number> {
  if (inputs.length === 0) return 0;
  
  const collection = await getCollection();
  const now = Date.now();
  
  const rows: MLDatasetRowV2[] = inputs.map(input => ({
    rowId: uuid(),
    runId: input.runId,
    scenarioId: input.scenarioId,
    symbol: input.symbol,
    timeframe: input.timeframe,
    timestamp: input.timestamp,
    schemaVersion: 'v2',
    features: input.features,
    labels: input.labels,
    meta: input.meta,
    createdAt: now,
  }));
  
  const result = await collection.insertMany(rows);
  
  logger.info({
    phase: 'dataset_v2',
    count: result.insertedCount,
  }, 'Dataset batch written');
  
  return result.insertedCount;
}

// ═══════════════════════════════════════════════════════════════
// READ OPERATIONS
// ═══════════════════════════════════════════════════════════════

export interface DatasetStats {
  totalRows: number;
  winRows: number;
  lossRows: number;
  winRate: number;
  avgR: number;
  avgMFE: number;
  avgMAE: number;
  symbols: string[];
  timeframes: string[];
  patternTypes: string[];
  dateRange: { start: number; end: number } | null;
  featureCount: number;
}

/**
 * Get dataset statistics
 */
export async function getDatasetStatsV2(): Promise<DatasetStats> {
  const collection = await getCollection();
  
  const pipeline = [
    {
      $group: {
        _id: null,
        totalRows: { $sum: 1 },
        winRows: { $sum: { $cond: [{ $eq: ['$labels.winLoss', 1] }, 1, 0] } },
        avgR: { $avg: '$labels.rMultiple' },
        avgMFE: { $avg: '$labels.mfePct' },
        avgMAE: { $avg: '$labels.maePct' },
        symbols: { $addToSet: '$symbol' },
        timeframes: { $addToSet: '$timeframe' },
        patternTypes: { $addToSet: '$meta.patternType' },
        minTs: { $min: '$timestamp' },
        maxTs: { $max: '$timestamp' },
      },
    },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  if (results.length === 0) {
    return {
      totalRows: 0,
      winRows: 0,
      lossRows: 0,
      winRate: 0,
      avgR: 0,
      avgMFE: 0,
      avgMAE: 0,
      symbols: [],
      timeframes: [],
      patternTypes: [],
      dateRange: null,
      featureCount: getFeatureNamesV2().length,
    };
  }
  
  const r = results[0];
  return {
    totalRows: r.totalRows,
    winRows: r.winRows,
    lossRows: r.totalRows - r.winRows,
    winRate: r.totalRows > 0 ? r.winRows / r.totalRows : 0,
    avgR: r.avgR ?? 0,
    avgMFE: r.avgMFE ?? 0,
    avgMAE: r.avgMAE ?? 0,
    symbols: r.symbols ?? [],
    timeframes: r.timeframes ?? [],
    patternTypes: r.patternTypes ?? [],
    dateRange: r.minTs && r.maxTs ? { start: r.minTs, end: r.maxTs } : null,
    featureCount: getFeatureNamesV2().length,
  };
}

/**
 * Get dataset rows with pagination
 */
export async function getDatasetRowsV2(options: {
  limit?: number;
  skip?: number;
  symbol?: string;
  timeframe?: string;
  runId?: string;
  minR?: number;
  maxR?: number;
}): Promise<MLDatasetRowV2[]> {
  const collection = await getCollection();
  
  const filter: any = {};
  if (options.symbol) filter.symbol = options.symbol;
  if (options.timeframe) filter.timeframe = options.timeframe;
  if (options.runId) filter.runId = options.runId;
  if (options.minR !== undefined) filter['labels.rMultiple'] = { $gte: options.minR };
  if (options.maxR !== undefined) {
    filter['labels.rMultiple'] = { ...filter['labels.rMultiple'], $lte: options.maxR };
  }
  
  const rows = await collection
    .find(filter, { projection: { _id: 0 } })
    .sort({ timestamp: -1 })
    .skip(options.skip ?? 0)
    .limit(options.limit ?? 100)
    .toArray();
  
  return rows as MLDatasetRowV2[];
}

// ═══════════════════════════════════════════════════════════════
// EXPORT OPERATIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Export dataset to CSV string
 */
export async function exportToCSV(options?: {
  symbol?: string;
  timeframe?: string;
  runId?: string;
  limit?: number;
}): Promise<string> {
  const rows = await getDatasetRowsV2({
    ...options,
    limit: options?.limit ?? 100000,
  });
  
  const header = getCSVHeader();
  const lines = rows.map(row => rowToCSV(row));
  
  return [header, ...lines].join('\n');
}

/**
 * Export dataset to JSON Lines (for Parquet conversion)
 */
export async function exportToJSONL(options?: {
  symbol?: string;
  timeframe?: string;
  runId?: string;
  limit?: number;
}): Promise<string> {
  const rows = await getDatasetRowsV2({
    ...options,
    limit: options?.limit ?? 100000,
  });
  
  // Convert to flat structure for ML
  const flatRows = rows.map(row => ({
    // Meta
    symbol: row.symbol,
    timeframe: row.timeframe,
    timestamp: row.timestamp,
    patternType: row.meta.patternType,
    side: row.meta.side,
    exitReason: row.meta.exitReason,
    
    // Features as flat object
    ...row.features,
    
    // Labels
    winLoss: row.labels.winLoss,
    rMultiple: row.labels.rMultiple,
    mfePct: row.labels.mfePct,
    maePct: row.labels.maePct,
    barsInTrade: row.labels.barsInTrade,
  }));
  
  return flatRows.map(r => JSON.stringify(r)).join('\n');
}

/**
 * Export feature matrix for ML (numpy-like)
 */
export async function exportFeatureMatrix(options?: {
  symbol?: string;
  timeframe?: string;
  runId?: string;
  limit?: number;
}): Promise<{ X: number[][]; y: number[]; meta: any[] }> {
  const rows = await getDatasetRowsV2({
    ...options,
    limit: options?.limit ?? 100000,
  });
  
  const X: number[][] = [];
  const y: number[] = [];
  const meta: any[] = [];
  
  for (const row of rows) {
    X.push(featuresToArray(row.features));
    y.push(row.labels.rMultiple);
    meta.push({
      rowId: row.rowId,
      symbol: row.symbol,
      timeframe: row.timeframe,
      timestamp: row.timestamp,
      patternType: row.meta.patternType,
      side: row.meta.side,
      exitReason: row.meta.exitReason,
      winLoss: row.labels.winLoss,
    });
  }
  
  return { X, y, meta };
}

// ═══════════════════════════════════════════════════════════════
// STATISTICS BY GROUP
// ═══════════════════════════════════════════════════════════════

export interface GroupStats {
  group: string;
  count: number;
  winRate: number;
  avgR: number;
  avgMFE: number;
  avgMAE: number;
}

/**
 * Get stats grouped by field
 */
export async function getStatsByGroup(groupField: string): Promise<GroupStats[]> {
  const collection = await getCollection();
  
  const fieldPath = groupField.includes('.') ? `$${groupField}` : `$meta.${groupField}`;
  
  const pipeline = [
    {
      $group: {
        _id: fieldPath,
        count: { $sum: 1 },
        wins: { $sum: { $cond: [{ $eq: ['$labels.winLoss', 1] }, 1, 0] } },
        avgR: { $avg: '$labels.rMultiple' },
        avgMFE: { $avg: '$labels.mfePct' },
        avgMAE: { $avg: '$labels.maePct' },
      },
    },
    { $sort: { count: -1 } },
  ];
  
  const results = await collection.aggregate(pipeline).toArray();
  
  return results.map(r => ({
    group: r._id ?? 'unknown',
    count: r.count,
    winRate: r.count > 0 ? r.wins / r.count : 0,
    avgR: r.avgR ?? 0,
    avgMFE: r.avgMFE ?? 0,
    avgMAE: r.avgMAE ?? 0,
  }));
}

// ═══════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════

/**
 * Delete rows by run
 */
export async function deleteByRun(runId: string): Promise<number> {
  const collection = await getCollection();
  const result = await collection.deleteMany({ runId });
  return result.deletedCount;
}

/**
 * Clear all v2 dataset
 */
export async function clearDatasetV2(): Promise<number> {
  const collection = await getCollection();
  const result = await collection.deleteMany({});
  return result.deletedCount;
}

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

export async function ensureIndexes(): Promise<void> {
  const collection = await getCollection();
  
  await collection.createIndex({ rowId: 1 }, { unique: true });
  await collection.createIndex({ runId: 1 });
  await collection.createIndex({ symbol: 1, timeframe: 1 });
  await collection.createIndex({ timestamp: 1 });
  await collection.createIndex({ 'meta.patternType': 1 });
  await collection.createIndex({ 'labels.winLoss': 1 });
  await collection.createIndex({ 'labels.rMultiple': 1 });
  
  logger.info({ phase: 'dataset_v2' }, 'Indexes ensured');
}
