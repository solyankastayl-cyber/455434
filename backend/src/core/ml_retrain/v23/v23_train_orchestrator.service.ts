/**
 * ML v2.3 - Training Orchestrator Service
 * 
 * Orchestrates v2.3 training:
 * 1. Load v2.3 config from admin settings
 * 2. Export dataset to CSV
 * 3. Call Python training service
 * 4. Save result to model registry as SHADOW
 */

import { FastifyInstance } from 'fastify';
import mongoose from 'mongoose';
import { 
  DEFAULT_PRUNING, 
  DEFAULT_WEIGHTING,
  type MlTask,
  type PruningConfig,
  type WeightingConfig,
  type V23Settings
} from './ml_v23.config.js';
import { pyTrainV23 } from './python_v23.client.js';
import { MlModelRegistryModel, type IFeatureMeta } from '../ml_model_registry.model.js';
import type { V23TrainResponse } from './ml_v23.types.js';

export interface V23TrainOptions {
  task: MlTask;
  network: string;
  datasetPath?: string;
  pruning?: Partial<PruningConfig>;
  weighting?: Partial<WeightingConfig>;
}

export interface V23TrainResult {
  ok: boolean;
  modelVersion: string;
  metrics: Record<string, number>;
  keptFeatures: string[];
  droppedFeatures: { name: string; reason: string }[];
  artifactsPath: string;
}

/**
 * Get v2.3 settings from admin settings collection
 */
async function getV23Settings(): Promise<V23Settings | null> {
  try {
    const db = mongoose.connection.db;
    if (!db) return null;
    
    const doc = await db.collection('admin_settings').findOne({ 
      category: 'ml_v23' 
    });
    
    return doc?.settings as V23Settings | null;
  } catch {
    return null;
  }
}

/**
 * Export dataset for training
 * Returns path to exported CSV file
 */
async function exportDataset(
  task: MlTask,
  network: string
): Promise<string> {
  const fs = await import('fs/promises');
  const path = await import('path');
  
  const db = mongoose.connection.db;
  if (!db) throw new Error('Database not available');
  
  // Get labeled data from feature store
  const collectionName = task === 'market' 
    ? 'ml_market_features' 
    : 'ml_actor_features';
  
  const cursor = db.collection(collectionName).find({
    network,
    label: { $exists: true, $ne: null }
  }).sort({ ts: -1 }).limit(10000);
  
  const docs = await cursor.toArray();
  
  if (docs.length === 0) {
    throw new Error(`No labeled data for ${task}/${network}`);
  }
  
  // Convert to CSV
  const headers = Object.keys(docs[0]).filter(k => k !== '_id');
  const rows = docs.map(doc => {
    return headers.map(h => {
      const val = doc[h];
      if (val === null || val === undefined) return '';
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    }).join(',');
  });
  
  const csv = [headers.join(','), ...rows].join('\n');
  
  // Save to file
  const exportDir = '/data/datasets/v2.3';
  await fs.mkdir(exportDir, { recursive: true });
  
  const timestamp = Date.now();
  const filePath = path.join(exportDir, `${task}_${network}_${timestamp}.csv`);
  
  await fs.writeFile(filePath, csv);
  
  console.log(`[v2.3] Exported ${docs.length} samples to ${filePath}`);
  
  return filePath;
}

/**
 * Save trained model to registry as SHADOW
 */
async function saveToRegistry(
  trainResult: V23TrainResponse
): Promise<void> {
  const featureMeta: IFeatureMeta = {
    keptFeatures: trainResult.keptFeatures,
    droppedFeatures: trainResult.droppedFeatures,
    importances: trainResult.importances,
    pruning: trainResult.pruningConfig,
    weighting: trainResult.weightingConfig,
  };
  
  const registry = new MlModelRegistryModel({
    modelType: trainResult.task,
    network: trainResult.network,
    version: trainResult.modelVersion,
    status: 'SHADOW',
    metrics: {
      accuracy: trainResult.metrics.accuracy,
      f1: trainResult.metrics.f1,
      precision: trainResult.metrics.precision,
      recall: trainResult.metrics.recall,
    },
    artifactPath: trainResult.artifactsPath,
    trainedAt: new Date(),
    featureMeta,
  });
  
  await registry.save();
  
  console.log(`[v2.3] Saved SHADOW model: ${trainResult.modelVersion}`);
}

/**
 * Train v2.3 SHADOW model
 */
export async function trainV23Shadow(
  app: FastifyInstance,
  options: V23TrainOptions
): Promise<V23TrainResult> {
  const { task, network } = options;
  
  console.log(`[v2.3] Starting training for ${task}/${network}`);
  
  // Load admin settings
  const settings = await getV23Settings();
  const taskConfig = settings?.[task] ?? {};
  
  // Merge configs with defaults and overrides
  const pruning: PruningConfig = {
    ...DEFAULT_PRUNING,
    ...(taskConfig.pruning ?? {}),
    ...(options.pruning ?? {}),
  };
  
  const weighting: WeightingConfig = {
    ...DEFAULT_WEIGHTING,
    ...(taskConfig.weighting ?? {}),
    ...(options.weighting ?? {}),
  };
  
  // Export dataset if not provided
  let datasetPath = options.datasetPath;
  if (!datasetPath) {
    datasetPath = await exportDataset(task, network);
  }
  
  // Call Python training
  const trainResult = await pyTrainV23({
    version: 'v2.3',
    task,
    network,
    datasetPath,
    pruning,
    weighting,
  });
  
  if (!trainResult.ok) {
    throw new Error('Python training failed');
  }
  
  // Save to registry
  await saveToRegistry(trainResult);
  
  return {
    ok: true,
    modelVersion: trainResult.modelVersion,
    metrics: trainResult.metrics,
    keptFeatures: trainResult.keptFeatures,
    droppedFeatures: trainResult.droppedFeatures,
    artifactsPath: trainResult.artifactsPath,
  };
}
