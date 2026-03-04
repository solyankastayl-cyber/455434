/**
 * P3 ML Model Loader
 * 
 * Loads and caches ML model artifacts
 */

import fs from 'fs';
import path from 'path';
import type { LoadedModel, MarketModelArtifacts } from './ml_inference.types.js';

// ============================================
// ACTOR MODEL LOADER
// ============================================

let cachedActorModel: LoadedModel | null = null;

/**
 * Load actor classification model
 * Uses simple linear model with softmax for baseline
 */
export function loadActorModel(): LoadedModel {
  if (cachedActorModel) return cachedActorModel;

  const modelPath = path.join(
    process.cwd(),
    'models',
    'actor_model_v1.json'
  );

  // If model file doesn't exist, return default baseline
  if (!fs.existsSync(modelPath)) {
    console.log('[P3 ML] Actor model not found, using baseline weights');
    cachedActorModel = {
      version: 'baseline_v1',
      classes: ['SMART', 'NEUTRAL', 'NOISY'],
      // Default weights: [inflowUsd, outflowUsd, netFlowUsd, roleScore, exchangeExposure, corridorDensity, corridorPersistence, volatility]
      weights: [0.3, -0.2, 0.5, 0.8, -0.6, 0.4, 0.5, -0.3],
      bias: -0.1,
    };
    return cachedActorModel;
  }

  const raw = fs.readFileSync(modelPath, 'utf-8');
  cachedActorModel = JSON.parse(raw);
  console.log(`[P3 ML] Loaded actor model version: ${cachedActorModel!.version}`);
  return cachedActorModel!;
}

// ============================================
// MARKET MODEL LOADER
// ============================================

let cachedMarketModel: MarketModelArtifacts | null = null;

/**
 * Load latest market prediction model
 */
export function loadLatestMarketModel(): MarketModelArtifacts {
  if (cachedMarketModel) return cachedMarketModel;

  const baseDir = path.join(process.cwd(), 'models', 'v2.0', 'market');
  
  // If directory doesn't exist, return baseline config
  if (!fs.existsSync(baseDir)) {
    console.log('[P3 ML] Market model directory not found, using baseline');
    cachedMarketModel = {
      modelPath: '',
      featureColumns: [
        'exchangePressure',
        'accZoneStrength',
        'distZoneStrength',
        'corridorsEntropy',
      ],
      version: 'baseline_v1',
    };
    return cachedMarketModel;
  }

  // Find latest version directory
  const versions = fs.readdirSync(baseDir)
    .filter(v => fs.statSync(path.join(baseDir, v)).isDirectory())
    .sort()
    .reverse();

  if (!versions.length) {
    console.log('[P3 ML] No trained market models found, using baseline');
    cachedMarketModel = {
      modelPath: '',
      featureColumns: [
        'exchangePressure',
        'accZoneStrength',
        'distZoneStrength',
        'corridorsEntropy',
      ],
      version: 'baseline_v1',
    };
    return cachedMarketModel;
  }

  const version = versions[0];
  const modelDir = path.join(baseDir, version);

  // Load feature columns
  const featureColsPath = path.join(modelDir, 'feature_columns.json');
  let featureColumns = [
    'exchangePressure',
    'accZoneStrength',
    'distZoneStrength',
    'corridorsEntropy',
  ];

  if (fs.existsSync(featureColsPath)) {
    featureColumns = JSON.parse(fs.readFileSync(featureColsPath, 'utf8'));
  }

  cachedMarketModel = {
    modelPath: path.join(modelDir, 'model.pkl'),
    featureColumns,
    version,
  };

  console.log(`[P3 ML] Loaded market model version: ${version}`);
  return cachedMarketModel;
}

/**
 * Reload models (for hot-reload after training)
 */
export function reloadModels(): void {
  cachedActorModel = null;
  cachedMarketModel = null;
  console.log('[P3 ML] Models cache cleared');
}

export default {
  loadActorModel,
  loadLatestMarketModel,
  reloadModels,
};
