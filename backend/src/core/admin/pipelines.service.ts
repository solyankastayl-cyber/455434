/**
 * Data Pipelines Service
 * 
 * Provides status of all data pipeline stages:
 * - transfers, features, labels, datasets
 * - ml_inference, signals
 */

import mongoose from 'mongoose';

// ============================================
// TYPES
// ============================================

export type PipelineStage = 
  | 'transfers' 
  | 'features' 
  | 'labels' 
  | 'datasets' 
  | 'ml_inference' 
  | 'signals';

export interface PipelineStatus {
  stage: PipelineStage;
  status: 'OK' | 'DEGRADED' | 'FAILED';
  lastRun: string | null;
  rows: number | null;
  latencyMs: number | null;
  notes: string | null;
}

export interface PipelinesData {
  pipelines: PipelineStatus[];
}

// ============================================
// COLLECTION MAPPINGS
// ============================================

const STAGE_COLLECTIONS: Record<PipelineStage, { collection: string; tsField: string }> = {
  transfers: { collection: 'transfers', tsField: 'blockTs' },
  features: { collection: 'feature_market_timeseries', tsField: 'ts' },
  labels: { collection: 'label_price_outcome', tsField: 'ts' },
  datasets: { collection: 'dataset_market', tsField: 'ts' },
  ml_inference: { collection: 'ml_inference_log', tsField: 'ts' },
  signals: { collection: 'signal_history', tsField: 'ts' },
};

// ============================================
// HELPERS
// ============================================

async function getCollectionCount(collectionName: string): Promise<number> {
  try {
    const db = mongoose.connection.db;
    if (!db) return 0;
    const collection = db.collection(collectionName);
    return await collection.estimatedDocumentCount();
  } catch {
    return 0;
  }
}

async function getLastDocument(collectionName: string, tsField: string): Promise<Date | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    const collection = db.collection(collectionName);
    const doc = await collection.findOne({}, { sort: { [tsField]: -1 } });
    if (!doc) return null;
    
    const ts = doc[tsField];
    if (typeof ts === 'number') {
      return new Date(ts * 1000);
    }
    if (ts instanceof Date) {
      return ts;
    }
    return null;
  } catch {
    return null;
  }
}

// ============================================
// MAIN SERVICE
// ============================================

export async function getPipelinesStatus(): Promise<PipelinesData> {
  const stages: PipelineStage[] = [
    'transfers', 'features', 'labels', 'datasets', 'ml_inference', 'signals'
  ];
  
  const pipelines: PipelineStatus[] = await Promise.all(
    stages.map(async (stage) => {
      const config = STAGE_COLLECTIONS[stage];
      const [rows, lastRunDate] = await Promise.all([
        getCollectionCount(config.collection),
        getLastDocument(config.collection, config.tsField),
      ]);
      
      const isRealtime = stage === 'ml_inference' || stage === 'signals';
      
      return {
        stage,
        status: rows > 0 ? 'OK' : 'DEGRADED',
        lastRun: lastRunDate?.toISOString() || null,
        rows: isRealtime ? null : rows,
        latencyMs: null, // Would need actual timing data
        notes: getStageNotes(stage),
      };
    })
  );
  
  return { pipelines };
}

function getStageNotes(stage: PipelineStage): string | null {
  switch (stage) {
    case 'features':
      return 'actor+market';
    case 'labels':
      return 'price guard';
    case 'datasets':
      return 'export ready';
    case 'ml_inference':
      return 'realtime';
    case 'signals':
      return 'ensemble';
    default:
      return null;
  }
}

export default {
  getPipelinesStatus,
};
