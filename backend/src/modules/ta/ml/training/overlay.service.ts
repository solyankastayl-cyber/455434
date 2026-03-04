/**
 * Phase 6: ML Overlay Service
 * 
 * Applies ML predictions to base probabilities with safety gates.
 * Supports SHADOW → LIVE rollout stages.
 */

import { spawn } from 'child_process';
import * as path from 'path';
import {
  ModelRecord,
  ModelStage,
  OverlayRequest,
  OverlayResponse,
  PredictionLog,
} from './domain.js';
import * as storage from './storage.js';
import { logger } from '../../infra/logger.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

interface OverlayConfig {
  enabled: boolean;
  pythonPath: string;
  predictScript: string;
  timeoutMs: number;
  alphaByStage: Record<ModelStage, number>;
  maxDeltaByStage: Record<ModelStage, number>;
}

const DEFAULT_CONFIG: OverlayConfig = {
  enabled: true,
  pythonPath: 'python3',
  predictScript: '/app/ml/predict.py',
  timeoutMs: 5000,  // Increased for initial model loading
  alphaByStage: {
    SHADOW: 0.0,       // No influence
    LIVE_LITE: 0.15,   // Slight influence
    LIVE_MED: 0.35,    // Moderate influence
    LIVE_FULL: 0.60,   // Strong influence
  },
  maxDeltaByStage: {
    SHADOW: 1.0,       // No clamping (just logging)
    LIVE_LITE: 0.15,
    LIVE_MED: 0.25,
    LIVE_FULL: 0.35,
  },
};

let config = { ...DEFAULT_CONFIG };

export function setOverlayConfig(updates: Partial<OverlayConfig>): void {
  config = { ...config, ...updates };
}

export function getOverlayConfig(): OverlayConfig {
  return { ...config };
}

// ═══════════════════════════════════════════════════════════════
// PYTHON INFERENCE
// ═══════════════════════════════════════════════════════════════

async function callPythonPredict(
  modelPath: string,
  features: Record<string, number>
): Promise<{ ok: boolean; probability?: number; error?: string }> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      resolve({ ok: false, error: 'timeout' });
    }, config.timeoutMs);
    
    try {
      const proc = spawn(config.pythonPath, [
        config.predictScript,
        '--model', modelPath,
        '--features', JSON.stringify(features),
      ]);
      
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (data) => { stdout += data; });
      proc.stderr.on('data', (data) => { stderr += data; });
      
      proc.on('close', (code) => {
        clearTimeout(timeout);
        
        if (code !== 0) {
          resolve({ ok: false, error: stderr || `exit code ${code}` });
          return;
        }
        
        try {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } catch (e) {
          resolve({ ok: false, error: 'invalid json response' });
        }
      });
      
      proc.on('error', (err) => {
        clearTimeout(timeout);
        resolve({ ok: false, error: err.message });
      });
      
    } catch (e) {
      clearTimeout(timeout);
      resolve({ ok: false, error: (e as Error).message });
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// MAIN OVERLAY FUNCTION
// ═══════════════════════════════════════════════════════════════

export async function applyOverlay(request: OverlayRequest): Promise<OverlayResponse> {
  const startTime = Date.now();
  const gatesApplied: string[] = [];
  
  const baseResponse: OverlayResponse = {
    ok: true,
    stage: 'SHADOW',
    probabilitySource: 'BASE',
    baseProbability: request.baseProbability,
    finalProbability: request.baseProbability,
    delta: 0,
    gatesApplied: [],
    latencyMs: 0,
  };
  
  if (!config.enabled) {
    gatesApplied.push('overlay_disabled');
    baseResponse.gatesApplied = gatesApplied;
    baseResponse.latencyMs = Date.now() - startTime;
    return baseResponse;
  }
  
  // Get active model
  const model = await storage.getActiveModel('WIN_PROB');
  if (!model) {
    gatesApplied.push('no_active_model');
    baseResponse.gatesApplied = gatesApplied;
    baseResponse.latencyMs = Date.now() - startTime;
    return baseResponse;
  }
  
  baseResponse.modelUsed = model.modelId;
  baseResponse.stage = model.stage;
  
  // Call Python inference
  const mlResult = await callPythonPredict(
    path.dirname(model.artifact.path),
    request.features
  );
  
  if (!mlResult.ok || mlResult.probability === undefined) {
    gatesApplied.push(`inference_error:${mlResult.error}`);
    baseResponse.gatesApplied = gatesApplied;
    baseResponse.latencyMs = Date.now() - startTime;
    return baseResponse;
  }
  
  const mlProbability = mlResult.probability;
  baseResponse.mlProbability = mlProbability;
  
  // Calculate delta
  let delta = mlProbability - request.baseProbability;
  
  // Apply delta clamp
  const maxDelta = config.maxDeltaByStage[model.stage];
  if (Math.abs(delta) > maxDelta) {
    gatesApplied.push(`delta_clamped:${delta.toFixed(3)}→${(Math.sign(delta) * maxDelta).toFixed(3)}`);
    delta = Math.sign(delta) * maxDelta;
  }
  
  // Get alpha for blending
  const alpha = config.alphaByStage[model.stage];
  
  // Calculate final probability
  let finalProbability: number;
  
  if (model.stage === 'SHADOW') {
    // SHADOW: no influence, just log
    finalProbability = request.baseProbability;
    baseResponse.probabilitySource = 'ML_SHADOW';
    gatesApplied.push('shadow_mode');
  } else {
    // LIVE: blend base and ML
    finalProbability = request.baseProbability + (delta * alpha);
    baseResponse.probabilitySource = 'ML_LIVE';
    gatesApplied.push(`alpha:${alpha}`);
  }
  
  // Clamp to valid probability range
  finalProbability = Math.max(0.01, Math.min(0.99, finalProbability));
  
  baseResponse.finalProbability = finalProbability;
  baseResponse.delta = delta;
  baseResponse.gatesApplied = gatesApplied;
  baseResponse.latencyMs = Date.now() - startTime;
  
  // Log prediction (async, don't wait)
  logPrediction(model, request, mlProbability, finalProbability).catch(() => {});
  
  return baseResponse;
}

// ═══════════════════════════════════════════════════════════════
// PREDICTION LOGGING
// ═══════════════════════════════════════════════════════════════

async function logPrediction(
  model: ModelRecord,
  request: OverlayRequest,
  mlProbability: number,
  finalProbability: number
): Promise<void> {
  const log: PredictionLog = {
    ts: request.ts || Date.now(),
    modelId: model.modelId,
    symbol: request.symbol,
    tf: request.tf,
    baseProbability: request.baseProbability,
    mlProbability,
    finalProbability,
    stage: model.stage,
  };
  
  await storage.insertPrediction(log);
}

// ═══════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════

export async function getOverlayStatus(): Promise<{
  enabled: boolean;
  activeModel: ModelRecord | null;
  config: OverlayConfig;
  recentStats: any;
}> {
  const activeModel = await storage.getActiveModel('WIN_PROB');
  const recentStats = activeModel
    ? await storage.getPredictionStats(activeModel.modelId)
    : null;
  
  return {
    enabled: config.enabled,
    activeModel,
    config,
    recentStats,
  };
}
