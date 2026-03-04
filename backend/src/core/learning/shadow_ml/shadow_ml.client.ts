/**
 * Shadow ML Client
 * 
 * ETAP 4: Client for communicating with Python ML service.
 */
import type { Horizon } from '../learning.types.js';
import type {
  TrainResult,
  ShadowEvalReport,
  MLServiceStatus,
} from './shadow_ml.types.js';

// ==================== CONFIG ====================

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || 'http://localhost:8002';
const TIMEOUT_MS = 30000;

// ==================== HTTP CLIENT ====================

async function fetchWithTimeout(
  url: string, 
  options: RequestInit = {},
  timeout: number = TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ==================== CLIENT FUNCTIONS ====================

/**
 * Check if ML service is available
 */
export async function checkMLServiceHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${ML_SERVICE_URL}/health`, {}, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get ML service status
 */
export async function getMLServiceStatus(): Promise<MLServiceStatus> {
  try {
    const response = await fetchWithTimeout(`${ML_SERVICE_URL}/status`);
    
    if (!response.ok) {
      return {
        available: false,
        models: {
          '7d': { ready: false },
          '30d': { ready: false },
        },
      };
    }
    
    const data = await response.json();
    return {
      available: true,
      models: data.models,
      last_train: data.last_train,
      last_predict: data.last_predict,
    };
    
  } catch {
    return {
      available: false,
      models: {
        '7d': { ready: false },
        '30d': { ready: false },
      },
    };
  }
}

/**
 * Train shadow model
 */
export async function trainShadowModel(
  horizon: Horizon,
  minSamples: number = 50,
  forceRetrain: boolean = false
): Promise<TrainResult> {
  const response = await fetchWithTimeout(
    `${ML_SERVICE_URL}/train`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        horizon,
        min_samples: minSamples,
        force_retrain: forceRetrain,
      }),
    },
    60000 // 60s timeout for training
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Training failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Get shadow predictions
 */
export async function getShadowPredictions(
  samples: any[],
  horizon: Horizon
): Promise<{
  predictions: Array<{
    snapshotId: string;
    p_success: number;
    confidence_modifier: number;
    drift_level: string;
    ml_confidence: number;
  }>;
  model_id: string;
  horizon: string;
}> {
  const response = await fetchWithTimeout(
    `${ML_SERVICE_URL}/predict`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        samples,
        horizon,
      }),
    }
  );
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Prediction failed: ${error}`);
  }
  
  return response.json();
}

/**
 * Get evaluation report
 */
export async function getEvaluation(horizon: Horizon): Promise<ShadowEvalReport> {
  const response = await fetchWithTimeout(`${ML_SERVICE_URL}/eval/${horizon}`);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Evaluation failed: ${error}`);
  }
  
  const data = await response.json();
  return {
    ...data,
    evaluated_at: new Date(data.evaluated_at),
  };
}

/**
 * Get expected feature list
 */
export async function getFeatureList(): Promise<{
  features: string[];
  label: string;
  version: string;
}> {
  const response = await fetchWithTimeout(`${ML_SERVICE_URL}/features`);
  
  if (!response.ok) {
    throw new Error('Failed to get feature list');
  }
  
  return response.json();
}
