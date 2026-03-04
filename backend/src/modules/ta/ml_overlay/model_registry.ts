/**
 * Phase L: Model Registry
 * 
 * Load and manage ML model artifacts
 */

import fs from 'fs';
import path from 'path';
import { LoadedModel, ModelMetrics } from './overlay_types.js';
import { getFeatureSchema } from './feature_schema.js';

// Cache for loaded models
const modelCache = new Map<string, LoadedModel>();

/**
 * Get artifacts directory path
 */
function getArtifactsDir(): string {
  return path.resolve(process.cwd(), 'artifacts/ml_overlay');
}

/**
 * Check if model artifacts exist
 */
export function modelExists(version: string): boolean {
  const base = getArtifactsDir();
  const schemaPath = path.join(base, `${version}_schema.json`);
  return fs.existsSync(schemaPath);
}

/**
 * Load model from local artifacts
 */
export function loadLocalModel(version: string): LoadedModel {
  // Check cache first
  const cached = modelCache.get(version);
  if (cached) return cached;

  const base = getArtifactsDir();
  const schemaPath = path.join(base, `${version}_schema.json`);
  const metricsPath = path.join(base, `${version}_metrics.json`);
  const artifactPath = path.join(base, `${version}_lgbm.joblib`);

  // Load schema
  let schema: any;
  if (fs.existsSync(schemaPath)) {
    schema = JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
  } else {
    // Use default schema if not found
    schema = getFeatureSchema();
    console.warn(`[ML Overlay] Schema not found for ${version}, using default`);
  }

  // Load metrics
  let metrics: ModelMetrics = {
    auc: 0.5,
    brier: 0.25,
    rows_train: 0,
    rows_val: 0,
    positive_rate: 0.5,
  };
  if (fs.existsSync(metricsPath)) {
    metrics = JSON.parse(fs.readFileSync(metricsPath, 'utf-8'));
  }

  const model: LoadedModel = {
    version,
    schema,
    metrics,
    artifactPath,
  };

  // Cache it
  modelCache.set(version, model);

  console.log(`[ML Overlay] Loaded model ${version}, AUC=${metrics.auc.toFixed(3)}`);

  return model;
}

/**
 * Get mock model for testing
 */
export function getMockModel(): LoadedModel {
  return {
    version: 'mock_v1',
    schema: getFeatureSchema(),
    metrics: {
      auc: 0.65,
      brier: 0.22,
      rows_train: 1000,
      rows_val: 200,
      positive_rate: 0.45,
    },
    artifactPath: '',
  };
}

/**
 * Clear model cache
 */
export function clearModelCache(): void {
  modelCache.clear();
}

/**
 * List available models
 */
export function listAvailableModels(): string[] {
  const base = getArtifactsDir();
  
  if (!fs.existsSync(base)) {
    return ['mock_v1'];  // Always have mock available
  }

  const files = fs.readdirSync(base);
  const versions = new Set<string>();

  for (const file of files) {
    const match = file.match(/^(.+)_schema\.json$/);
    if (match) {
      versions.add(match[1]);
    }
  }

  return ['mock_v1', ...Array.from(versions)];
}

/**
 * Save model artifacts (for training pipeline)
 */
export function saveModelArtifacts(
  version: string,
  schema: any,
  metrics: ModelMetrics
): void {
  const base = getArtifactsDir();
  
  if (!fs.existsSync(base)) {
    fs.mkdirSync(base, { recursive: true });
  }

  fs.writeFileSync(
    path.join(base, `${version}_schema.json`),
    JSON.stringify(schema, null, 2)
  );

  fs.writeFileSync(
    path.join(base, `${version}_metrics.json`),
    JSON.stringify(metrics, null, 2)
  );

  // Clear cache to reload
  modelCache.delete(version);

  console.log(`[ML Overlay] Saved artifacts for ${version}`);
}
