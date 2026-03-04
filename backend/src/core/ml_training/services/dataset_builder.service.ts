/**
 * ML Dataset Builder (P0.8)
 * 
 * Builds training datasets from feature snapshots.
 * NO training logic. NO model code. Just data preparation.
 */

import { FeatureSnapshotModel } from '../../ml_features_v2/storage/feature_snapshot.model.js';
import { vectorToArray, getFeatureNames } from '../../ml_features_v2/normalization/index.js';
import { FEATURE_TAXONOMY_VERSION, FeatureVector } from '../../ml_features_v2/types/feature.types.js';
import { enforceTrainingDatasetQuality } from './gate_enforcer.service.js';
import crypto from 'crypto';

// ============================================
// Types
// ============================================

export interface DatasetConfig {
  entityTypes?: Array<'WALLET' | 'TOKEN' | 'ACTOR'>;
  minCoverage?: number;
  minQualityScore?: number;
  windowStart?: Date;
  windowEnd?: Date;
  limit?: number;
  includeNormalized?: boolean;
}

export interface TrainingSample {
  entityType: string;
  entityId: string;
  snapshotId: string;
  features: number[];
  metadata: {
    coverage: number;
    qualityScore?: number;
    timestamp: Date;
  };
}

export interface TrainingDataset {
  version: string;
  taxonomyVersion: string;
  featureNames: string[];
  featureCount: number;
  
  samples: TrainingSample[];
  sampleCount: number;
  
  // Split info
  trainSamples: number;
  valSamples: number;
  
  // Quality info
  avgCoverage: number;
  passRate: number;
  blockedCount: number;
  
  // Hash for reproducibility
  datasetHash: string;
  
  createdAt: Date;
}

// ============================================
// Dataset Builder
// ============================================

/**
 * Build training dataset from feature snapshots
 */
export async function buildTrainingDataset(
  config: DatasetConfig = {}
): Promise<TrainingDataset> {
  const {
    entityTypes = ['WALLET', 'TOKEN', 'ACTOR'],
    minCoverage = 0.5,
    windowStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days
    windowEnd = new Date(),
    limit = 10000
  } = config;
  
  // Query snapshots
  const query: any = {
    entityType: { $in: entityTypes },
    buildTimestamp: { $gte: windowStart, $lte: windowEnd },
    'coverage.coveragePercent': { $gte: minCoverage * 100 }
  };
  
  const snapshots = await FeatureSnapshotModel.find(query)
    .sort({ buildTimestamp: -1 })
    .limit(limit)
    .lean();
  
  if (snapshots.length === 0) {
    throw new Error('No feature snapshots found matching criteria');
  }
  
  // Convert to feature vectors for gate check
  const vectors: FeatureVector[] = snapshots.map(s => ({
    entityType: s.entityType,
    entityId: s.entityId,
    windowStart: s.windowStart,
    windowEnd: s.windowEnd,
    taxonomyVersion: s.taxonomyVersion,
    routes: s.routes || {},
    dex: s.dex || {},
    market: s.market || {},
    actor: s.actor || {},
    watchlist: s.watchlist || {},
    system: s.system || {},
    coverage: s.coverage,
    buildTimestamp: s.buildTimestamp,
    buildDurationMs: s.buildDurationMs || 0
  }));
  
  // Enforce quality gates on dataset
  const { validVectors, passRate, blockedCount } = await enforceTrainingDatasetQuality(vectors);
  
  // Build samples
  const featureNames = getFeatureNames();
  const samples: TrainingSample[] = [];
  let totalCoverage = 0;
  
  for (const vector of validVectors) {
    const features = vectorToArray(vector);
    const snapshot = snapshots.find(s => s.entityId === vector.entityId);
    
    samples.push({
      entityType: vector.entityType,
      entityId: vector.entityId,
      snapshotId: snapshot?.snapshotId || 'unknown',
      features,
      metadata: {
        coverage: vector.coverage?.coveragePercent || 0,
        timestamp: vector.buildTimestamp
      }
    });
    
    totalCoverage += (vector.coverage?.coveragePercent || 0);
  }
  
  // Calculate validation split (20%)
  const valCount = Math.floor(samples.length * 0.2);
  const trainCount = samples.length - valCount;
  
  // Generate dataset hash for reproducibility
  const datasetHash = generateDatasetHash(samples);
  
  // Generate version
  const version = `v${Date.now()}`;
  
  return {
    version,
    taxonomyVersion: FEATURE_TAXONOMY_VERSION,
    featureNames,
    featureCount: featureNames.length,
    
    samples,
    sampleCount: samples.length,
    
    trainSamples: trainCount,
    valSamples: valCount,
    
    avgCoverage: samples.length > 0 ? Math.round(totalCoverage / samples.length) : 0,
    passRate,
    blockedCount,
    
    datasetHash,
    createdAt: new Date()
  };
}

/**
 * Split dataset into train/val
 */
export function splitDataset(
  dataset: TrainingDataset,
  valRatio: number = 0.2
): {
  train: TrainingSample[];
  val: TrainingSample[];
} {
  const shuffled = [...dataset.samples].sort(() => Math.random() - 0.5);
  const valCount = Math.floor(shuffled.length * valRatio);
  
  return {
    train: shuffled.slice(valCount),
    val: shuffled.slice(0, valCount)
  };
}

/**
 * Get dataset summary statistics
 */
export function getDatasetStats(dataset: TrainingDataset): {
  sampleCount: number;
  featureCount: number;
  avgCoverage: number;
  coverageDistribution: Record<string, number>;
  entityTypeDistribution: Record<string, number>;
} {
  const coverageBuckets: Record<string, number> = {
    '0-25%': 0,
    '26-50%': 0,
    '51-75%': 0,
    '76-100%': 0
  };
  
  const entityTypes: Record<string, number> = {};
  
  for (const sample of dataset.samples) {
    // Coverage distribution
    const cov = sample.metadata.coverage;
    if (cov <= 25) coverageBuckets['0-25%']++;
    else if (cov <= 50) coverageBuckets['26-50%']++;
    else if (cov <= 75) coverageBuckets['51-75%']++;
    else coverageBuckets['76-100%']++;
    
    // Entity type distribution
    entityTypes[sample.entityType] = (entityTypes[sample.entityType] || 0) + 1;
  }
  
  return {
    sampleCount: dataset.sampleCount,
    featureCount: dataset.featureCount,
    avgCoverage: dataset.avgCoverage,
    coverageDistribution: coverageBuckets,
    entityTypeDistribution: entityTypes
  };
}

// ============================================
// Helpers
// ============================================

function generateDatasetHash(samples: TrainingSample[]): string {
  const data = samples.map(s => `${s.entityId}:${s.snapshotId}`).join('|');
  return crypto.createHash('sha256').update(data).digest('hex').slice(0, 16);
}
