/**
 * Phase 6: ML Model Registry Storage
 */

import { getDb } from '../../../../db/mongodb.js';
import {
  ModelRecord,
  ModelStage,
  ModelTask,
  PredictionLog,
  DriftReport,
} from './domain.js';

// ═══════════════════════════════════════════════════════════════
// COLLECTIONS
// ═══════════════════════════════════════════════════════════════

const MODELS_COLLECTION = 'ta_ml_models';
const PREDICTIONS_COLLECTION = 'ta_ml_predictions';
const DRIFT_COLLECTION = 'ta_ml_drift';
const BASELINES_COLLECTION = 'ta_ml_baselines';

async function modelsCol() {
  const db = await getDb();
  return db.collection(MODELS_COLLECTION);
}

async function predsCol() {
  const db = await getDb();
  return db.collection(PREDICTIONS_COLLECTION);
}

async function driftCol() {
  const db = await getDb();
  return db.collection(DRIFT_COLLECTION);
}

async function baselinesCol() {
  const db = await getDb();
  return db.collection(BASELINES_COLLECTION);
}

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRY
// ═══════════════════════════════════════════════════════════════

export async function insertModel(model: ModelRecord): Promise<void> {
  const col = await modelsCol();
  await col.insertOne(model);
}

export async function listModels(filter: Partial<ModelRecord> = {}): Promise<ModelRecord[]> {
  const col = await modelsCol();
  return col.find(filter, { projection: { _id: 0 } })
    .sort({ createdAt: -1 })
    .toArray() as Promise<ModelRecord[]>;
}

export async function getModel(modelId: string): Promise<ModelRecord | null> {
  const col = await modelsCol();
  return col.findOne({ modelId }, { projection: { _id: 0 } }) as Promise<ModelRecord | null>;
}

export async function getActiveModel(task: ModelTask): Promise<ModelRecord | null> {
  const col = await modelsCol();
  return col.findOne(
    { task, enabled: true },
    { projection: { _id: 0 }, sort: { createdAt: -1 } }
  ) as Promise<ModelRecord | null>;
}

export async function getLatestModel(task: ModelTask): Promise<ModelRecord | null> {
  const col = await modelsCol();
  return col.findOne(
    { task },
    { projection: { _id: 0 }, sort: { createdAt: -1 } }
  ) as Promise<ModelRecord | null>;
}

export async function setModelStage(modelId: string, stage: ModelStage): Promise<void> {
  const col = await modelsCol();
  await col.updateOne({ modelId }, { $set: { stage } });
}

export async function setModelEnabled(modelId: string, enabled: boolean): Promise<void> {
  const col = await modelsCol();
  
  // If enabling, disable all other models of same task
  if (enabled) {
    const model = await getModel(modelId);
    if (model) {
      await col.updateMany(
        { task: model.task, modelId: { $ne: modelId } },
        { $set: { enabled: false } }
      );
    }
  }
  
  await col.updateOne({ modelId }, { $set: { enabled } });
}

export async function deleteModel(modelId: string): Promise<void> {
  const col = await modelsCol();
  await col.deleteOne({ modelId });
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION LOG
// ═══════════════════════════════════════════════════════════════

export async function insertPrediction(pred: PredictionLog): Promise<void> {
  const col = await predsCol();
  await col.insertOne(pred);
}

export async function getRecentPredictions(
  modelId: string,
  limit: number = 100
): Promise<PredictionLog[]> {
  const col = await predsCol();
  return col.find({ modelId }, { projection: { _id: 0 } })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray() as Promise<PredictionLog[]>;
}

export async function getPredictionStats(modelId: string): Promise<{
  count: number;
  avgBase: number;
  avgMl: number;
  avgDelta: number;
}> {
  const col = await predsCol();
  const pipeline = [
    { $match: { modelId } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        avgBase: { $avg: '$baseProbability' },
        avgMl: { $avg: '$mlProbability' },
        avgDelta: { $avg: { $subtract: ['$mlProbability', '$baseProbability'] } },
      },
    },
  ];
  
  const results = await col.aggregate(pipeline).toArray();
  if (results.length === 0) {
    return { count: 0, avgBase: 0, avgMl: 0, avgDelta: 0 };
  }
  
  return {
    count: results[0].count,
    avgBase: results[0].avgBase ?? 0,
    avgMl: results[0].avgMl ?? 0,
    avgDelta: results[0].avgDelta ?? 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// DRIFT REPORTS
// ═══════════════════════════════════════════════════════════════

export async function insertDriftReport(report: DriftReport): Promise<void> {
  const col = await driftCol();
  await col.insertOne(report);
}

export async function getLatestDrift(modelId: string): Promise<DriftReport | null> {
  const col = await driftCol();
  return col.findOne(
    { modelId },
    { projection: { _id: 0 }, sort: { ts: -1 } }
  ) as Promise<DriftReport | null>;
}

export async function getDriftHistory(
  modelId: string,
  limit: number = 50
): Promise<DriftReport[]> {
  const col = await driftCol();
  return col.find({ modelId }, { projection: { _id: 0 } })
    .sort({ ts: -1 })
    .limit(limit)
    .toArray() as Promise<DriftReport[]>;
}

// ═══════════════════════════════════════════════════════════════
// BASELINES
// ═══════════════════════════════════════════════════════════════

export async function saveBaseline(
  modelId: string,
  bins: Record<string, number[]>
): Promise<void> {
  const col = await baselinesCol();
  await col.updateOne(
    { modelId },
    { $set: { modelId, bins, updatedAt: Date.now() } },
    { upsert: true }
  );
}

export async function getBaseline(modelId: string): Promise<Record<string, number[]> | null> {
  const col = await baselinesCol();
  const doc = await col.findOne({ modelId });
  return doc?.bins ?? null;
}

// ═══════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════

export async function ensureIndexes(): Promise<void> {
  const models = await modelsCol();
  const preds = await predsCol();
  const drift = await driftCol();
  
  await models.createIndex({ modelId: 1 }, { unique: true });
  await models.createIndex({ task: 1, enabled: 1 });
  await models.createIndex({ createdAt: -1 });
  
  await preds.createIndex({ modelId: 1, ts: -1 });
  await preds.createIndex({ symbol: 1, tf: 1, ts: -1 });
  
  await drift.createIndex({ modelId: 1, ts: -1 });
  await drift.createIndex({ status: 1, ts: -1 });
  
  console.log('[ML Registry] Indexes ensured');
}
