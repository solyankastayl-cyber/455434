/**
 * Phase W: Dataset Writer
 * 
 * Writes ML training rows to MongoDB and exports to CSV.
 */

import { MLDatasetRow, getFeatureNames } from './feature_schema.js';
import { getDb } from '../../../db/mongodb.js';
import { logger } from '../infra/logger.js';

const COLLECTION_NAME = 'ta_ml_rows_v1';

export interface DatasetStats {
  totalRows: number;
  winRows: number;
  lossRows: number;
  winRate: number;
  features: number;
  symbols: string[];
  timeframes: string[];
  dateRange: {
    start: number;
    end: number;
  };
}

/**
 * Initialize dataset indexes
 */
export async function initDatasetIndexes(): Promise<void> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  await collection.createIndex({ symbol: 1, timeframe: 1, timestamp: 1 });
  await collection.createIndex({ runId: 1 });
  await collection.createIndex({ label: 1 });
  await collection.createIndex({ timestamp: 1 });
  
  logger.info({ phase: 'ml', collection: COLLECTION_NAME }, 'Dataset indexes created');
}

/**
 * Write a single dataset row
 */
export async function writeDatasetRow(row: MLDatasetRow): Promise<void> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  await collection.insertOne({
    ...row,
    createdAt: Date.now(),
  });
}

/**
 * Write multiple dataset rows
 */
export async function writeDatasetRows(rows: MLDatasetRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const docs = rows.map(row => ({
    ...row,
    createdAt: Date.now(),
  }));
  
  const result = await collection.insertMany(docs);
  
  logger.info({ 
    phase: 'ml', 
    inserted: result.insertedCount 
  }, 'Dataset rows written');
  
  return result.insertedCount;
}

/**
 * Get dataset statistics
 */
export async function getDatasetStats(): Promise<DatasetStats> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const totalRows = await collection.countDocuments();
  const winRows = await collection.countDocuments({ label: 1 });
  const lossRows = await collection.countDocuments({ label: 0 });
  
  const symbols = await collection.distinct('symbol');
  const timeframes = await collection.distinct('timeframe');
  
  const dateRange = await collection.aggregate([
    {
      $group: {
        _id: null,
        minTimestamp: { $min: '$timestamp' },
        maxTimestamp: { $max: '$timestamp' },
      },
    },
  ]).toArray();
  
  return {
    totalRows,
    winRows,
    lossRows,
    winRate: totalRows > 0 ? winRows / totalRows : 0,
    features: getFeatureNames().length,
    symbols,
    timeframes,
    dateRange: {
      start: dateRange[0]?.minTimestamp || 0,
      end: dateRange[0]?.maxTimestamp || 0,
    },
  };
}

/**
 * Query dataset rows
 */
export async function queryDatasetRows(
  filter: any = {},
  options: { limit?: number; skip?: number; sort?: any } = {}
): Promise<MLDatasetRow[]> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const { limit = 1000, skip = 0, sort = { timestamp: 1 } } = options;
  
  const rows = await collection
    .find(filter, { projection: { _id: 0 } })
    .sort(sort)
    .skip(skip)
    .limit(limit)
    .toArray();
  
  return rows as MLDatasetRow[];
}

/**
 * Export dataset to CSV format
 */
export async function exportDatasetCSV(
  filter: any = {},
  options: { includeHeader?: boolean } = {}
): Promise<string> {
  const { includeHeader = true } = options;
  const rows = await queryDatasetRows(filter, { limit: 100000 });
  
  if (rows.length === 0) return '';
  
  const featureNames = getFeatureNames();
  const lines: string[] = [];
  
  // Header
  if (includeHeader) {
    const headerCols = [
      'runId', 'scenarioId', 'symbol', 'timeframe', 'timestamp',
      ...featureNames,
      'label', 'entry', 'stop', 'target'
    ];
    lines.push(headerCols.join(','));
  }
  
  // Data rows
  for (const row of rows) {
    const featureValues = featureNames.map(name => 
      (row.features as any)[name] ?? 0
    );
    
    const cols = [
      row.runId,
      row.scenarioId,
      row.symbol,
      row.timeframe,
      row.timestamp,
      ...featureValues,
      row.label,
      row.meta?.entry || 0,
      row.meta?.stop || 0,
      row.meta?.target || 0,
    ];
    
    lines.push(cols.join(','));
  }
  
  return lines.join('\n');
}

/**
 * Clear dataset (for testing)
 */
export async function clearDataset(): Promise<number> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const result = await collection.deleteMany({});
  
  logger.warn({ 
    phase: 'ml', 
    deleted: result.deletedCount 
  }, 'Dataset cleared');
  
  return result.deletedCount;
}

/**
 * Get dataset preview (sample rows)
 */
export async function getDatasetPreview(n: number = 10): Promise<MLDatasetRow[]> {
  const db = await getDb();
  const collection = db.collection(COLLECTION_NAME);
  
  const rows = await collection
    .find({}, { projection: { _id: 0 } })
    .limit(n)
    .toArray();
  
  return rows as MLDatasetRow[];
}
