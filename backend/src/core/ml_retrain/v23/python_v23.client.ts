/**
 * ML v2.3 - Python Client Extension
 * 
 * Calls Python ML service for v2.3 training.
 */

import { env } from '../../../config/env.js';
import type { MlTask, PruningConfig, WeightingConfig } from './ml_v23.config.js';
import type { V23TrainResponse } from './ml_v23.types.js';

export interface V23TrainRequest {
  version: string;
  task: MlTask;
  network: string;
  datasetPath: string;
  pruning: PruningConfig;
  weighting: WeightingConfig;
}

/**
 * Call Python ML service for v2.3 training
 */
export async function pyTrainV23(req: V23TrainRequest): Promise<V23TrainResponse> {
  const url = `${env.PY_ML_URL}/api/v23/train`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PY_ML_TIMEOUT_MS * 2); // v2.3 takes longer

  try {
    console.log(`[PyML v2.3] Training ${req.task}/${req.network}`);
    console.log(`[PyML v2.3] Pruning: ${req.pruning.mode}, Weighting: ${req.weighting.mode}`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PY_TRAIN_V23_HTTP_${response.status}: ${text}`);
    }

    const data = await response.json() as V23TrainResponse;
    
    console.log(`[PyML v2.3] Complete: ${data.modelVersion}`);
    console.log(`[PyML v2.3] Features: ${data.keptFeatures.length} kept, ${data.droppedFeatures.length} dropped`);
    console.log(`[PyML v2.3] Metrics: accuracy=${data.metrics.accuracy}, f1=${data.metrics.f1}`);
    
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`PY_TRAIN_V23_TIMEOUT: Training exceeded ${env.PY_ML_TIMEOUT_MS * 2}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if v2.3 endpoint is available
 */
export async function pyV23Health(): Promise<boolean> {
  try {
    const response = await fetch(`${env.PY_ML_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (!response.ok) return false;
    
    const data = await response.json();
    return data.status === 'ok';
  } catch {
    return false;
  }
}
