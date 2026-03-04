/**
 * BATCH 2: Dataset Export Service
 * 
 * Exports datasets from MongoDB to CSV files for Python ML training.
 * Runs periodically to keep datasets fresh.
 */

import { Schema, model, Document } from 'mongoose';
import * as fs from 'fs';
import * as path from 'path';

// Dataset snapshot model
export interface IDatasetSnapshot extends Document {
  task: 'market' | 'actor';
  version: string;
  network: string;
  rows: number;
  features: string[];
  filePath: string;
  createdAt: Date;
}

const DatasetSnapshotSchema = new Schema<IDatasetSnapshot>({
  task: { type: String, enum: ['market', 'actor'], required: true },
  version: { type: String, required: true },
  network: { type: String, required: true },
  rows: { type: Number, required: true },
  features: [{ type: String }],
  filePath: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
});

DatasetSnapshotSchema.index({ task: 1, version: 1, network: 1 });

export const DatasetSnapshotModel = model<IDatasetSnapshot>(
  'dataset_snapshots',
  DatasetSnapshotSchema
);

// Datasets directory
const DATASETS_DIR = process.env.DATASETS_DIR || '/data/datasets';

/**
 * Export market dataset to CSV
 */
export async function exportMarketDataset(
  version: string,
  network: string = 'ethereum'
): Promise<{ filePath: string; rows: number }> {
  const mongoose = await import('mongoose');
  const db = mongoose.connection.db;
  
  // Fetch market features from ml_features collection
  const features = await db.collection('ml_market_features')
    .find({ network })
    .sort({ timestamp: -1 })
    .limit(10000)
    .toArray();
  
  if (features.length === 0) {
    throw new Error(`No market features found for network: ${network}`);
  }
  
  // Define columns
  const columns = [
    'exchangePressure',
    'accZoneStrength',
    'distZoneStrength',
    'corridorsEntropy',
    'volatility',
    'momentum',
    'y'
  ];
  
  // Convert to CSV rows
  const rows: string[] = [columns.join(',')];
  
  for (const f of features) {
    const row = [
      f.exchangePressure ?? 0,
      f.accZoneStrength ?? 0.5,
      f.distZoneStrength ?? 0.5,
      f.corridorsEntropy ?? 0.5,
      f.volatility ?? 0,
      f.momentum ?? 0,
      f.y ?? 0  // Target: 1=UP, 0=DOWN
    ].join(',');
    rows.push(row);
  }
  
  // Write to file
  const dirPath = path.join(DATASETS_DIR, version, 'market');
  fs.mkdirSync(dirPath, { recursive: true });
  
  const filePath = path.join(dirPath, 'latest.csv');
  fs.writeFileSync(filePath, rows.join('\n'));
  
  console.log(`[DatasetExport] Market dataset exported: ${filePath} (${features.length} rows)`);
  
  // Save snapshot record
  await DatasetSnapshotModel.create({
    task: 'market',
    version,
    network,
    rows: features.length,
    features: columns,
    filePath,
  });
  
  return { filePath, rows: features.length };
}

/**
 * Export actor dataset to CSV
 */
export async function exportActorDataset(
  version: string,
  network: string = 'ethereum'
): Promise<{ filePath: string; rows: number }> {
  const mongoose = await import('mongoose');
  const db = mongoose.connection.db;
  
  // Fetch actor features from ml_actor_features collection
  const features = await db.collection('ml_actor_features')
    .find({ network })
    .sort({ timestamp: -1 })
    .limit(50000)
    .toArray();
  
  if (features.length === 0) {
    throw new Error(`No actor features found for network: ${network}`);
  }
  
  // Define columns
  const columns = [
    'netFlowUsd',
    'inflowUsd',
    'outflowUsd',
    'hubScore',
    'pagerank',
    'brokerScore',
    'kCore',
    'entropyOut',
    'exchangeExposure',
    'corridorDensity',
    'y'
  ];
  
  // Convert to CSV rows
  const rows: string[] = [columns.join(',')];
  
  for (const f of features) {
    const row = [
      f.netFlowUsd ?? 0,
      f.inflowUsd ?? 0,
      f.outflowUsd ?? 0,
      f.hubScore ?? 0,
      f.pagerank ?? 0,
      f.brokerScore ?? 0,
      f.kCore ?? 1,
      f.entropyOut ?? 0.5,
      f.exchangeExposure ?? 0,
      f.corridorDensity ?? 0,
      f.y ?? 1  // Target: 2=SMART, 1=NEUTRAL, 0=NOISY
    ].join(',');
    rows.push(row);
  }
  
  // Write to file
  const dirPath = path.join(DATASETS_DIR, version, 'actor');
  fs.mkdirSync(dirPath, { recursive: true });
  
  const filePath = path.join(dirPath, 'latest.csv');
  fs.writeFileSync(filePath, rows.join('\n'));
  
  console.log(`[DatasetExport] Actor dataset exported: ${filePath} (${features.length} rows)`);
  
  // Save snapshot record
  await DatasetSnapshotModel.create({
    task: 'actor',
    version,
    network,
    rows: features.length,
    features: columns,
    filePath,
  });
  
  return { filePath, rows: features.length };
}

/**
 * Export all datasets
 */
export async function exportAllDatasets(version: string = 'v2.0'): Promise<void> {
  try {
    await exportMarketDataset(version, 'ethereum');
  } catch (err: any) {
    console.warn(`[DatasetExport] Market export failed: ${err.message}`);
  }
  
  try {
    await exportActorDataset(version, 'ethereum');
  } catch (err: any) {
    console.warn(`[DatasetExport] Actor export failed: ${err.message}`);
  }
}

// Export interval (15 minutes)
let exportInterval: NodeJS.Timeout | null = null;

export function startDatasetExportJob(): void {
  if (exportInterval) return;
  
  console.log('[DatasetExport] Starting periodic export job (every 15 min)');
  
  // Run immediately
  exportAllDatasets().catch(err => {
    console.error('[DatasetExport] Initial export failed:', err);
  });
  
  // Schedule periodic runs
  exportInterval = setInterval(() => {
    exportAllDatasets().catch(err => {
      console.error('[DatasetExport] Export failed:', err);
    });
  }, 15 * 60 * 1000); // 15 minutes
}

export function stopDatasetExportJob(): void {
  if (exportInterval) {
    clearInterval(exportInterval);
    exportInterval = null;
    console.log('[DatasetExport] Export job stopped');
  }
}
