/**
 * BATCH 2: Python ML Client
 * 
 * Node.js client for Python ML Training Service.
 * Python is the executor, Node.js is the orchestrator.
 */

import { env } from '../../config/env.js';

export type TrainTask = 'market' | 'actor';

export interface PyTrainRequest {
  task: TrainTask;
  dataset_version: string;
  dataset_id?: string | null;
  params?: Record<string, any>;
}

export interface PyTrainResponse {
  ok: boolean;
  task: TrainTask;
  model_version: string;
  metrics: Record<string, any>;
  artifact_path: string;
}

export interface PyValidateRequest {
  task: TrainTask;
  model_version: string;
  dataset_version: string;
  dataset_id?: string | null;
}

export interface PyValidateResponse {
  ok: boolean;
  task: TrainTask;
  model_version: string;
  metrics: Record<string, any>;
}

/**
 * Call Python ML service to train model
 */
export async function pyTrain(req: PyTrainRequest): Promise<PyTrainResponse> {
  const url = `${env.PY_ML_URL}/api/v2/train`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PY_ML_TIMEOUT_MS);

  try {
    console.log(`[PyML] Training ${req.task} model (dataset: ${req.dataset_version})`);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PY_TRAIN_HTTP_${response.status}: ${text}`);
    }

    const data = await response.json() as PyTrainResponse;
    
    console.log(`[PyML] Training complete: ${data.model_version}`);
    console.log(`[PyML] Metrics: accuracy=${data.metrics.accuracy}, f1=${data.metrics.f1 || data.metrics.f1_macro}`);
    
    return data;
  } catch (error: any) {
    if (error.name === 'AbortError') {
      throw new Error(`PY_TRAIN_TIMEOUT: Training exceeded ${env.PY_ML_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Call Python ML service to validate model (placeholder for BATCH 3)
 */
export async function pyValidate(req: PyValidateRequest): Promise<PyValidateResponse> {
  const url = `${env.PY_ML_URL}/api/v2/validate`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.PY_ML_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`PY_VALIDATE_HTTP_${response.status}: ${text}`);
    }

    return await response.json() as PyValidateResponse;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check Python ML service health
 */
export async function pyHealth(): Promise<boolean> {
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

/**
 * Get available datasets from Python service
 */
export async function pyGetDatasets(): Promise<any> {
  const response = await fetch(`${env.PY_ML_URL}/api/v2/datasets`, {
    method: 'GET',
    signal: AbortSignal.timeout(10000),
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get datasets: ${response.status}`);
  }
  
  return await response.json();
}
