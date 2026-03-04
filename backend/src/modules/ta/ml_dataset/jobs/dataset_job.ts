/**
 * Phase K: Dataset Build Job
 * 
 * Scheduled/manual job to build ML dataset
 */

import { Db } from 'mongodb';
import { buildDataset, getDatasetStats } from '../dataset_builder.js';
import { exportDataset, getDefaultPaths } from '../dataset_writer.js';
import { DatasetBuildOptions, DatasetBuildResult } from '../dataset_types.js';

export interface DatasetJobParams {
  db: Db;
  options?: DatasetBuildOptions;
  exportCSV?: boolean;
  exportJSON?: boolean;
  exportMongo?: boolean;
}

export interface DatasetJobResult {
  ok: boolean;
  build: DatasetBuildResult;
  exports: {
    csv?: { path: string; rows: number };
    json?: { path: string; rows: number };
    mongo?: { collection: string; inserted: number };
  };
  timestamp: string;
}

/**
 * Run dataset build job
 */
export async function runDatasetBuild(params: DatasetJobParams): Promise<DatasetJobResult> {
  const {
    db,
    options = {},
    exportCSV = true,
    exportJSON = false,
    exportMongo = true,
  } = params;

  console.log('[ML Dataset Job] Starting dataset build...');

  // Build dataset
  const build = await buildDataset({
    db,
    options: {
      ...options,
      limit: options.limit || 10000,
    },
  });

  console.log(`[ML Dataset Job] Built ${build.rows.length} rows`);
  console.log(`[ML Dataset Job] Stats: ${JSON.stringify(build.stats)}`);

  // Export dataset
  const paths = getDefaultPaths();
  const exports = await exportDataset(build.rows, db, {
    csvPath: exportCSV ? paths.csvPath : undefined,
    jsonPath: exportJSON ? paths.jsonPath : undefined,
    mongoCollection: exportMongo ? 'ta_ml_rows' : undefined,
  });

  return {
    ok: build.ok,
    build,
    exports,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get job status / preview
 */
export async function getDatasetJobStatus(db: Db): Promise<{
  ok: boolean;
  stats: {
    runsCount: number;
    scenariosCount: number;
    outcomesCount: number;
    winsCount: number;
    lossesCount: number;
    pendingCount: number;
  };
  lastExport?: {
    rowCount: number;
    generatedAt: string;
  };
}> {
  const stats = await getDatasetStats({ db });

  // Check last exported dataset
  let lastExport;
  try {
    const lastRow = await db.collection('ta_ml_rows')
      .findOne({}, { sort: { insertedAt: -1 } });
    
    if (lastRow) {
      const rowCount = await db.collection('ta_ml_rows').countDocuments();
      lastExport = {
        rowCount,
        generatedAt: lastRow.insertedAt?.toISOString() || 'unknown',
      };
    }
  } catch {
    // Collection may not exist
  }

  return {
    ok: true,
    stats,
    lastExport,
  };
}

/**
 * Initialize indexes for ml_rows collection
 */
export async function initDatasetIndexes(db: Db): Promise<void> {
  try {
    await db.collection('ta_ml_rows').createIndex(
      { runId: 1, scenarioId: 1 },
      { unique: true, background: true }
    );
    await db.collection('ta_ml_rows').createIndex(
      { asset: 1, createdAt: -1 },
      { background: true }
    );
    await db.collection('ta_ml_rows').createIndex(
      { outcome: 1 },
      { background: true }
    );
    await db.collection('ta_ml_rows').createIndex(
      { marketRegime: 1, volRegime: 1 },
      { background: true }
    );
    console.log('[ML Dataset] Indexes initialized');
  } catch (err) {
    console.error('[ML Dataset] Failed to create indexes:', err);
  }
}
