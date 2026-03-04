/**
 * Phase 6: ML Registry Service
 * 
 * Manages model lifecycle, quality gates, and rollout.
 */

import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  ModelRecord,
  ModelStage,
  ModelTask,
  QualityGates,
  RolloutCheck,
  TrainRequest,
  TrainResult,
  DriftReport,
} from './domain.js';
import * as storage from './storage.js';
import { exportToJSONL } from '../dataset_writer_v2.js';
import { logger } from '../../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// QUALITY GATES BY STAGE
// ═══════════════════════════════════════════════════════════════

const GATES_BY_STAGE: Record<ModelStage, Partial<QualityGates>> = {
  SHADOW: {
    minRowsToEnable: 200,
  },
  LIVE_LITE: {
    minRowsToEnable: 5000,
    minAucToEnable: 0.56,
    maxEceToEnable: 0.08,
    maxDeltaProb: 0.15,
  },
  LIVE_MED: {
    minRowsToEnable: 25000,
    minAucToEnable: 0.60,
    maxEceToEnable: 0.06,
    maxDeltaProb: 0.25,
  },
  LIVE_FULL: {
    minRowsToEnable: 100000,
    minAucToEnable: 0.63,
    maxEceToEnable: 0.05,
    maxDeltaProb: 0.35,
  },
};

// ═══════════════════════════════════════════════════════════════
// MODEL REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function registerModel(
  artifactPath: string,
  modelId?: string
): Promise<ModelRecord> {
  // Read meta.json from artifact
  const metaPath = path.join(artifactPath, 'meta.json');
  if (!fs.existsSync(metaPath)) {
    throw new Error(`meta.json not found at ${metaPath}`);
  }
  
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
  
  const record: ModelRecord = {
    modelId: modelId || meta.model_id || `model_${Date.now()}`,
    createdAt: Date.now(),
    stage: 'SHADOW',
    enabled: false,
    symbolScope: 'GLOBAL',
    tfScope: 'GLOBAL',
    task: meta.task || 'WIN_PROB',
    rThreshold: meta.r_threshold,
    artifact: {
      kind: 'LOCAL_FILE',
      path: path.join(artifactPath, 'model.joblib'),
      checksumSha256: meta.artifact?.checksum_sha256 || '',
    },
    metrics: {
      rows: meta.rows,
      featuresVersion: meta.features_version || 'v2',
      featuresCount: meta.features_count,
      target: meta.task || 'WIN_PROB',
      auc: meta.metrics?.auc,
      logloss: meta.metrics?.logloss,
      brier: meta.metrics?.brier,
      ece: meta.metrics?.ece,
    },
    gates: meta.gates || GATES_BY_STAGE.LIVE_LITE,
  };
  
  await storage.insertModel(record);
  
  logger.info({
    phase: 'ml_registry',
    modelId: record.modelId,
    auc: record.metrics.auc,
    rows: record.metrics.rows,
  }, 'Model registered');
  
  return record;
}

// ═══════════════════════════════════════════════════════════════
// ROLLOUT CHECK
// ═══════════════════════════════════════════════════════════════

export async function checkRollout(
  modelId: string,
  targetStage: ModelStage
): Promise<RolloutCheck> {
  const model = await storage.getModel(modelId);
  if (!model) {
    return {
      canEnable: false,
      targetStage,
      reasons: ['model_not_found'],
      metrics: {},
    };
  }
  
  const reasons: string[] = [];
  const gates = GATES_BY_STAGE[targetStage];
  
  // Check rows
  if (gates.minRowsToEnable && model.metrics.rows < gates.minRowsToEnable) {
    reasons.push(`rows:${model.metrics.rows}<${gates.minRowsToEnable}`);
  }
  
  // Check AUC
  if (gates.minAucToEnable && (model.metrics.auc ?? 0) < gates.minAucToEnable) {
    reasons.push(`auc:${model.metrics.auc?.toFixed(3)}<${gates.minAucToEnable}`);
  }
  
  // Check ECE
  if (gates.maxEceToEnable && (model.metrics.ece ?? 1) > gates.maxEceToEnable) {
    reasons.push(`ece:${model.metrics.ece?.toFixed(3)}>${gates.maxEceToEnable}`);
  }
  
  // Check drift
  const latestDrift = await storage.getLatestDrift(modelId);
  if (latestDrift && targetStage !== 'SHADOW') {
    if (latestDrift.status === 'DRIFT' || latestDrift.status === 'HARD_DRIFT') {
      reasons.push(`drift:${latestDrift.status}(score=${latestDrift.driftScore})`);
    }
  }
  
  return {
    canEnable: reasons.length === 0,
    targetStage,
    reasons,
    metrics: model.metrics,
    drift: latestDrift ?? undefined,
  };
}

// ═══════════════════════════════════════════════════════════════
// STAGE MANAGEMENT
// ═══════════════════════════════════════════════════════════════

export async function setStage(
  modelId: string,
  stage: ModelStage,
  force: boolean = false
): Promise<{ ok: boolean; message: string }> {
  if (!force) {
    const check = await checkRollout(modelId, stage);
    if (!check.canEnable) {
      return {
        ok: false,
        message: `Gates not passed: ${check.reasons.join(', ')}`,
      };
    }
  }
  
  await storage.setModelStage(modelId, stage);
  
  logger.info({
    phase: 'ml_registry',
    modelId,
    stage,
    forced: force,
  }, 'Model stage updated');
  
  return { ok: true, message: `Stage set to ${stage}` };
}

export async function enableModel(
  modelId: string,
  force: boolean = false
): Promise<{ ok: boolean; message: string }> {
  const model = await storage.getModel(modelId);
  if (!model) {
    return { ok: false, message: 'Model not found' };
  }
  
  if (!force) {
    const check = await checkRollout(modelId, model.stage);
    if (!check.canEnable) {
      return {
        ok: false,
        message: `Gates not passed: ${check.reasons.join(', ')}`,
      };
    }
  }
  
  await storage.setModelEnabled(modelId, true);
  
  logger.info({
    phase: 'ml_registry',
    modelId,
    enabled: true,
  }, 'Model enabled');
  
  return { ok: true, message: 'Model enabled' };
}

export async function disableModel(modelId: string): Promise<void> {
  await storage.setModelEnabled(modelId, false);
  
  logger.info({
    phase: 'ml_registry',
    modelId,
    enabled: false,
  }, 'Model disabled');
}

// ═══════════════════════════════════════════════════════════════
// TRAINING
// ═══════════════════════════════════════════════════════════════

export async function trainModel(request: TrainRequest): Promise<TrainResult> {
  const modelId = request.modelId || `model_${Date.now()}`;
  const outputDir = request.outputDir || `/app/ml_artifacts/${modelId}`;
  
  // Export dataset to JSONL
  const datasetPath = `/tmp/dataset_${modelId}.jsonl`;
  const jsonl = await exportToJSONL();
  fs.writeFileSync(datasetPath, jsonl);
  
  logger.info({
    phase: 'ml_training',
    modelId,
    datasetPath,
  }, 'Training started');
  
  // Run training script
  return new Promise((resolve) => {
    const proc = spawn('python3', [
      '/app/ml/train.py',
      '--jsonl', datasetPath,
      '--out', outputDir,
    ]);
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout.on('data', (data) => {
      stdout += data;
      console.log(`[ML Train] ${data}`);
    });
    
    proc.stderr.on('data', (data) => {
      stderr += data;
      console.error(`[ML Train] ${data}`);
    });
    
    proc.on('close', async (code) => {
      // Cleanup
      try { fs.unlinkSync(datasetPath); } catch {}
      
      if (code !== 0) {
        resolve({
          ok: false,
          modelId,
          metrics: {} as any,
          artifactPath: outputDir,
          gatesPassed: false,
          error: stderr || `Exit code ${code}`,
        });
        return;
      }
      
      // Read metrics
      try {
        const metaPath = path.join(outputDir, 'meta.json');
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        
        const gatesPassed = 
          (meta.metrics?.auc ?? 0) >= 0.56 &&
          (meta.metrics?.ece ?? 1) <= 0.08;
        
        // Auto-register
        await registerModel(outputDir, modelId);
        
        resolve({
          ok: true,
          modelId,
          metrics: meta.metrics,
          artifactPath: outputDir,
          gatesPassed,
        });
        
      } catch (e) {
        resolve({
          ok: false,
          modelId,
          metrics: {} as any,
          artifactPath: outputDir,
          gatesPassed: false,
          error: (e as Error).message,
        });
      }
    });
    
    proc.on('error', (err) => {
      resolve({
        ok: false,
        modelId,
        metrics: {} as any,
        artifactPath: outputDir,
        gatesPassed: false,
        error: err.message,
      });
    });
  });
}

// ═══════════════════════════════════════════════════════════════
// LIST / STATUS
// ═══════════════════════════════════════════════════════════════

export async function listModels(): Promise<ModelRecord[]> {
  return storage.listModels();
}

export async function getModel(modelId: string): Promise<ModelRecord | null> {
  return storage.getModel(modelId);
}

export async function getActiveModel(): Promise<ModelRecord | null> {
  return storage.getActiveModel('WIN_PROB');
}
