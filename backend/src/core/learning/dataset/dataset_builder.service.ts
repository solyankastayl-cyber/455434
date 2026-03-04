/**
 * Dataset Builder Service
 * 
 * ETAP 3.4: Main service for building ML training samples.
 * 
 * Combines:
 * - PredictionSnapshot
 * - OutcomeObservation
 * - TrendValidation
 * - AttributionOutcomeLink
 * 
 * Into clean, trainable samples with quality gates.
 * 
 * NO side effects on Ranking/Engine - READ ONLY from source models.
 */
import { v4 as uuidv4 } from 'uuid';
import { LearningSampleModel, type ILearningSample } from './learning_sample.model.js';
import { DatasetBuildRunModel, type IDatasetBuildRun } from './dataset_build_run.model.js';
import { PredictionSnapshotModel, type IPredictionSnapshot } from '../models/PredictionSnapshot.model.js';
import { OutcomeObservationModel, type IOutcomeObservation } from '../models/OutcomeObservation.model.js';
import { TrendValidationModel, type ITrendValidation } from '../models/trend_validation.model.js';
import { AttributionOutcomeLinkModel, type IAttributionOutcomeLink } from '../models/attribution_outcome_link.model.js';
import { buildFeatureVector } from './dataset_feature_extractor.js';
import { buildLabels, calculateLabelCoverage } from './dataset_label_builder.js';
import type { Horizon, DriftLevel } from '../learning.types.js';
import type {
  DatasetBuildConfig,
  BuildRunResult,
  SampleQuality,
  DATASET_SCHEMA_VERSION,
} from '../types/dataset.types.js';

// ==================== TYPES ====================

export interface SampleBuildResult {
  snapshotId: string;
  status: 'created' | 'updated' | 'skipped' | 'error';
  sampleId?: string;
  reason?: string;
}

export interface BuildBatchResult {
  processed: number;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  skipReasons: Record<string, number>;
  details: SampleBuildResult[];
}

const SCHEMA_VERSION = 'v1.0.0';

// ==================== GATES ====================

interface GateResult {
  pass: boolean;
  trainEligible: boolean;
  reasons: string[];
}

/**
 * Check hard gates - sample cannot be built without these
 */
function checkHardGates(
  snapshot: IPredictionSnapshot | null,
  trend: ITrendValidation | null,
  links: IAttributionOutcomeLink[]
): GateResult {
  const reasons: string[] = [];
  
  if (!snapshot) {
    return { pass: false, trainEligible: false, reasons: ['NO_SNAPSHOT'] };
  }
  
  if (!trend) {
    return { pass: false, trainEligible: false, reasons: ['NO_TREND_VALIDATION'] };
  }
  
  // Must have at least one horizon trend
  const hasTrend = trend.horizons?.['1d'] || trend.horizons?.['7d'] || trend.horizons?.['30d'];
  if (!hasTrend) {
    return { pass: false, trainEligible: false, reasons: ['NO_HORIZON_TREND'] };
  }
  
  // Must have at least one attribution link
  if (links.length === 0) {
    return { pass: false, trainEligible: false, reasons: ['NO_ATTRIBUTION_LINK'] };
  }
  
  return { pass: true, trainEligible: true, reasons };
}

/**
 * Check soft gates - affects trainEligible flag
 */
function checkSoftGates(
  snapshot: IPredictionSnapshot,
  config: DatasetBuildConfig
): GateResult {
  const reasons: string[] = [];
  let trainEligible = true;
  
  // CRITICAL drift gate
  const driftLevel = snapshot.liveContext.driftLevel as DriftLevel;
  if (driftLevel === 'CRITICAL') {
    if (!config.includeCriticalDrift) {
      trainEligible = false;
      reasons.push('CRITICAL_DRIFT');
    }
  }
  
  return { pass: true, trainEligible, reasons };
}

// ==================== CORE FUNCTIONS ====================

/**
 * Build a single sample for a snapshot
 */
export async function buildSampleForSnapshot(
  snapshotId: string,
  config: DatasetBuildConfig
): Promise<SampleBuildResult> {
  try {
    // Check if sample already exists
    const existingSample = await LearningSampleModel.findOne({ snapshotId });
    if (existingSample && config.mode === 'incremental') {
      return { snapshotId, status: 'skipped', reason: 'ALREADY_EXISTS' };
    }
    
    // Fetch all required data in parallel
    const [snapshot, outcome, trend, links] = await Promise.all([
      PredictionSnapshotModel.findOne({ snapshotId }).lean(),
      OutcomeObservationModel.findOne({ snapshotId }).lean(),
      TrendValidationModel.findOne({ snapshotId }).lean(),
      AttributionOutcomeLinkModel.find({ snapshotId }).lean(),
    ]);
    
    // Hard gates check
    const hardGates = checkHardGates(snapshot, trend, links);
    if (!hardGates.pass) {
      return { 
        snapshotId, 
        status: 'skipped', 
        reason: hardGates.reasons[0] 
      };
    }
    
    // Soft gates check
    const softGates = checkSoftGates(snapshot!, config);
    
    // Build features
    const features = buildFeatureVector(
      snapshot!,
      links[0], // Use first link for signal attribution
      null // TODO: Fetch approved LIVE window if needed
    );
    
    // Build labels
    const labelLinks = links.map(l => ({ horizon: l.horizon, verdict: l.verdict }));
    const labels = buildLabels(trend, outcome, labelLinks);
    
    // Calculate coverage
    const labelCoverage = calculateLabelCoverage(labels);
    
    // Build quality metrics
    const quality: SampleQuality = {
      trainEligible: hardGates.trainEligible && softGates.trainEligible,
      reasons: [...hardGates.reasons, ...softGates.reasons],
      liveCoverage: features.live.liveCoverage,
      trendCoverage: labelCoverage.trendCoverage,
      verdictCoverage: labelCoverage.verdictCoverage,
      dataCompleteness: calculateDataCompleteness(features, labels),
    };
    
    // Create sample ID
    const sampleId = `${snapshotId}:all`;
    
    // Build sample document
    const sampleData: Omit<ILearningSample, 'createdAt' | 'updatedAt'> = {
      sampleId,
      snapshotId,
      tokenAddress: snapshot!.token.address.toLowerCase(),
      symbol: snapshot!.token.symbol,
      horizon: '7d', // Primary horizon for v1
      snapshotAt: new Date(snapshot!.decidedAt),
      features,
      labels,
      quality,
      schemaVersion: SCHEMA_VERSION,
      builtAt: new Date(),
    };
    
    // Upsert sample
    await LearningSampleModel.findOneAndUpdate(
      { sampleId },
      { $set: sampleData },
      { upsert: true, new: true }
    );
    
    return {
      snapshotId,
      status: existingSample ? 'updated' : 'created',
      sampleId,
    };
    
  } catch (error: any) {
    return { snapshotId, status: 'error', reason: error.message };
  }
}

/**
 * Calculate data completeness score
 */
function calculateDataCompleteness(features: any, labels: any): number {
  let score = 0;
  let total = 0;
  
  // Feature completeness
  total += 4; // 4 feature categories
  if (features.snapshot.compositeScore > 0) score++;
  if (features.live.liveCoverage !== 'NONE') score++;
  if (features.drift.driftLevel) score++;
  if (features.market.priceAtDecision > 0) score++;
  
  // Label completeness
  total += 6; // trend + verdict for 3 horizons
  if (labels.trends.trend_1d) score++;
  if (labels.trends.trend_7d) score++;
  if (labels.trends.trend_30d) score++;
  if (labels.verdicts.verdict_1d) score++;
  if (labels.verdicts.verdict_7d) score++;
  if (labels.verdicts.verdict_30d) score++;
  
  return Math.round((score / total) * 100) / 100;
}

/**
 * Build samples in batch
 */
export async function buildSamples(
  config: DatasetBuildConfig
): Promise<BuildBatchResult> {
  const result: BuildBatchResult = {
    processed: 0,
    created: 0,
    updated: 0,
    skipped: 0,
    errors: 0,
    skipReasons: {},
    details: [],
  };
  
  // Build query for snapshots
  const query: any = {};
  if (config.since) {
    query.decidedAt = { $gte: config.since };
  }
  if (config.until) {
    query.decidedAt = { ...query.decidedAt, $lte: config.until };
  }
  
  // Get snapshots
  const limit = config.limit || 500;
  const snapshots = await PredictionSnapshotModel.find(query)
    .select('snapshotId')
    .sort({ decidedAt: -1 })
    .limit(limit)
    .lean();
  
  // If incremental mode, filter out already built
  let snapshotIds = snapshots.map(s => s.snapshotId);
  if (config.mode === 'incremental') {
    const existing = await LearningSampleModel.find({
      snapshotId: { $in: snapshotIds },
    }).select('snapshotId').lean();
    
    const existingSet = new Set(existing.map(e => e.snapshotId));
    snapshotIds = snapshotIds.filter(id => !existingSet.has(id));
  }
  
  // Process each snapshot
  for (const snapshotId of snapshotIds) {
    const buildResult = await buildSampleForSnapshot(snapshotId, config);
    result.details.push(buildResult);
    result.processed++;
    
    switch (buildResult.status) {
      case 'created':
        result.created++;
        break;
      case 'updated':
        result.updated++;
        break;
      case 'skipped':
        result.skipped++;
        if (buildResult.reason) {
          result.skipReasons[buildResult.reason] = 
            (result.skipReasons[buildResult.reason] || 0) + 1;
        }
        break;
      case 'error':
        result.errors++;
        break;
    }
  }
  
  return result;
}

/**
 * Run a full build with journaling
 */
export async function runDatasetBuild(
  config: DatasetBuildConfig
): Promise<BuildRunResult> {
  const runId = uuidv4();
  const startedAt = new Date();
  
  // Create run record
  await DatasetBuildRunModel.create({
    runId,
    startedAt,
    finishedAt: null,
    status: 'running',
    config,
    stats: {
      processed: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
      skipReasons: {},
    },
  });
  
  try {
    console.log(`[DatasetBuilder] Starting build run ${runId}`);
    
    const result = await buildSamples(config);
    
    const finishedAt = new Date();
    
    // Update run record
    await DatasetBuildRunModel.findOneAndUpdate(
      { runId },
      {
        $set: {
          finishedAt,
          status: 'completed',
          stats: {
            processed: result.processed,
            created: result.created,
            updated: result.updated,
            skipped: result.skipped,
            errors: result.errors,
            skipReasons: result.skipReasons,
          },
        },
      }
    );
    
    console.log(`[DatasetBuilder] Build run ${runId} completed: ${result.created} created, ${result.skipped} skipped`);
    
    return {
      runId,
      startedAt,
      finishedAt,
      config,
      stats: {
        processed: result.processed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        skipReasons: result.skipReasons,
      },
    };
    
  } catch (error: any) {
    // Update run record with error
    await DatasetBuildRunModel.findOneAndUpdate(
      { runId },
      {
        $set: {
          finishedAt: new Date(),
          status: 'failed',
          error: error.message,
        },
      }
    );
    
    console.error(`[DatasetBuilder] Build run ${runId} failed:`, error);
    throw error;
  }
}

// ==================== QUERY FUNCTIONS ====================

/**
 * Get samples with filters
 */
export async function getSamples(
  filters: {
    horizon?: Horizon;
    bucket?: string;
    verdict?: string;
    trainEligible?: boolean;
    limit?: number;
    offset?: number;
  }
): Promise<{ samples: ILearningSample[]; total: number }> {
  const query: any = {};
  
  if (filters.horizon) query.horizon = filters.horizon;
  if (filters.bucket) query['features.snapshot.bucket'] = filters.bucket;
  if (filters.verdict) query['labels.verdicts.verdict_7d'] = filters.verdict;
  if (filters.trainEligible !== undefined) {
    query['quality.trainEligible'] = filters.trainEligible;
  }
  
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;
  
  const [samples, total] = await Promise.all([
    LearningSampleModel.find(query)
      .sort({ builtAt: -1 })
      .skip(offset)
      .limit(limit)
      .lean(),
    LearningSampleModel.countDocuments(query),
  ]);
  
  return { samples, total };
}

/**
 * Get recent build runs
 */
export async function getRecentBuildRuns(limit: number = 10): Promise<IDatasetBuildRun[]> {
  return DatasetBuildRunModel.find()
    .sort({ startedAt: -1 })
    .limit(limit)
    .lean();
}
