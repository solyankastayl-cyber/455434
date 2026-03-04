/**
 * Dataset Freezer Service
 * 
 * ETAP 5.2: Creates immutable, versioned datasets for ML training.
 * 
 * Key principles:
 * - Dataset is frozen after creation (immutable)
 * - Every dataset has unique version ID
 * - Content hash ensures reproducibility
 * - Same samples + filters = same hash (deduplication)
 */
import { LearningSampleModel } from '../learning/dataset/learning_sample.model.js';
import { DatasetVersionModel, type IDatasetVersion } from './dataset_version.model.js';
import { generateDatasetHash, generateDatasetVersionId, verifyDatasetIntegrity } from './dataset_hash.util.js';
import type { Horizon, DriftLevel, DatasetVersionFilters, DatasetVersion } from './self_learning.types.js';

// ==================== TYPES ====================

export interface FreezeDatasetOptions {
  horizon: Horizon;
  filters?: Partial<DatasetVersionFilters>;
  createdBy?: 'scheduler' | 'manual';
  reuseExisting?: boolean; // If true, return existing dataset with same hash
}

export interface FreezeDatasetResult {
  success: boolean;
  datasetVersion: string | null;
  isNew: boolean;
  sampleCount: number;
  contentHash: string;
  message: string;
  dataset?: IDatasetVersion;
}

// ==================== DEFAULT FILTERS ====================

const DEFAULT_FILTERS: DatasetVersionFilters = {
  trainEligible: true,
  trends: ['TREND_UP', 'TREND_DOWN'],
  driftLevels: ['LOW', 'MEDIUM'],
  minConfidence: undefined,
};

// ==================== SERVICE ====================

/**
 * Freeze dataset for training
 * 
 * Creates an immutable snapshot of training data.
 */
export async function freezeDataset(options: FreezeDatasetOptions): Promise<FreezeDatasetResult> {
  const { horizon, createdBy = 'scheduler', reuseExisting = true } = options;
  
  // Merge filters with defaults
  const filters: DatasetVersionFilters = {
    ...DEFAULT_FILTERS,
    ...options.filters,
  };
  
  console.log(`[DatasetFreezer] Freezing dataset for ${horizon} with filters:`, filters);
  
  try {
    // Build query for samples
    const query: any = {
      'quality.trainEligible': filters.trainEligible,
    };
    
    // Filter by drift levels (exclude CRITICAL by default)
    if (filters.driftLevels.length > 0) {
      query['features.drift.driftLevel'] = { $in: filters.driftLevels };
    }
    
    // Filter by trends that have labels
    const trendKey = `labels.trends.trend_${horizon}`;
    if (filters.trends.length > 0) {
      query[trendKey] = { $in: filters.trends };
    }
    
    // Filter by verdict existence
    const verdictKey = `labels.verdicts.verdict_${horizon}`;
    query[verdictKey] = { $exists: true, $ne: null };
    
    // Fetch samples (only IDs and labels for efficiency)
    const samples = await LearningSampleModel.find(query)
      .select('snapshotId labels.verdicts features.snapshot.bucket snapshotAt')
      .sort({ snapshotAt: 1 })
      .lean();
    
    if (samples.length === 0) {
      return {
        success: false,
        datasetVersion: null,
        isNew: false,
        sampleCount: 0,
        contentHash: '',
        message: 'No samples match the filters',
      };
    }
    
    // Extract sample IDs
    const sampleIds = samples.map(s => s.snapshotId);
    
    // Calculate content hash
    const contentHash = generateDatasetHash(sampleIds, filters, horizon);
    
    // Check for existing dataset with same hash
    if (reuseExisting) {
      const existing = await DatasetVersionModel.findByHash(contentHash);
      if (existing) {
        console.log(`[DatasetFreezer] Found existing dataset with same hash: ${existing.datasetVersion}`);
        return {
          success: true,
          datasetVersion: existing.datasetVersion,
          isNew: false,
          sampleCount: existing.sampleCount,
          contentHash: existing.contentHash,
          message: 'Reusing existing dataset with identical content',
          dataset: existing,
        };
      }
    }
    
    // Calculate class distribution
    const verdictKey2 = `labels.verdicts.verdict_${horizon}`;
    let positive = 0;
    let negative = 0;
    
    for (const sample of samples) {
      const verdict = sample.labels?.verdicts?.[`verdict_${horizon}`];
      const bucket = sample.features?.snapshot?.bucket;
      
      // Success = TRUE_POSITIVE or DELAYED_TRUE for BUY/SELL
      if (bucket === 'BUY' || bucket === 'SELL') {
        if (verdict === 'TRUE_POSITIVE' || verdict === 'DELAYED_TRUE') {
          positive++;
        } else {
          negative++;
        }
      }
    }
    
    const ratio = negative > 0 ? positive / negative : positive;
    
    // Get time range
    const sortedSamples = samples.sort((a, b) => 
      new Date(a.snapshotAt).getTime() - new Date(b.snapshotAt).getTime()
    );
    const earliestSample = new Date(sortedSamples[0].snapshotAt);
    const latestSample = new Date(sortedSamples[sortedSamples.length - 1].snapshotAt);
    
    // Generate version ID
    const datasetVersion = generateDatasetVersionId(horizon);
    
    // Create frozen dataset
    const dataset = await DatasetVersionModel.create({
      datasetVersion,
      horizon,
      sampleIds,
      sampleCount: samples.length,
      filters,
      contentHash,
      classDistribution: {
        positive,
        negative,
        ratio,
      },
      earliestSample,
      latestSample,
      createdBy,
      status: 'FROZEN',
    });
    
    console.log(`[DatasetFreezer] Created dataset ${datasetVersion}: ${samples.length} samples, hash=${contentHash.slice(0, 8)}`);
    
    return {
      success: true,
      datasetVersion,
      isNew: true,
      sampleCount: samples.length,
      contentHash,
      message: `Dataset frozen: ${samples.length} samples (${positive} positive, ${negative} negative)`,
      dataset,
    };
    
  } catch (error: any) {
    console.error('[DatasetFreezer] Error freezing dataset:', error);
    return {
      success: false,
      datasetVersion: null,
      isNew: false,
      sampleCount: 0,
      contentHash: '',
      message: `Error: ${error.message}`,
    };
  }
}

/**
 * Get dataset by version ID
 */
export async function getDatasetVersion(datasetVersion: string): Promise<IDatasetVersion | null> {
  return DatasetVersionModel.findOne({ datasetVersion }).lean();
}

/**
 * Get latest frozen dataset for horizon
 */
export async function getLatestFrozenDataset(horizon: Horizon): Promise<IDatasetVersion | null> {
  return DatasetVersionModel.findLatestFrozen(horizon);
}

/**
 * List datasets for horizon
 */
export async function listDatasets(
  horizon?: Horizon,
  limit: number = 20
): Promise<IDatasetVersion[]> {
  const query: any = {};
  if (horizon) query.horizon = horizon;
  
  return DatasetVersionModel.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
}

/**
 * Verify dataset integrity
 */
export async function verifyDataset(datasetVersion: string): Promise<{
  valid: boolean;
  message: string;
}> {
  const dataset = await DatasetVersionModel.findOne({ datasetVersion }).lean();
  
  if (!dataset) {
    return { valid: false, message: 'Dataset not found' };
  }
  
  // Refetch samples and verify hash
  const samples = await LearningSampleModel.find({
    snapshotId: { $in: dataset.sampleIds },
  }).select('snapshotId').lean();
  
  const currentIds = samples.map(s => s.snapshotId);
  
  const { valid, computedHash } = verifyDatasetIntegrity(
    currentIds,
    dataset.filters,
    dataset.horizon,
    dataset.contentHash
  );
  
  if (!valid) {
    return {
      valid: false,
      message: `Hash mismatch: expected ${dataset.contentHash.slice(0, 8)}, got ${computedHash.slice(0, 8)}`,
    };
  }
  
  if (currentIds.length !== dataset.sampleCount) {
    return {
      valid: false,
      message: `Sample count mismatch: expected ${dataset.sampleCount}, got ${currentIds.length}`,
    };
  }
  
  return { valid: true, message: 'Dataset integrity verified' };
}

/**
 * Get statistics about datasets
 */
export async function getDatasetStats(): Promise<{
  total: number;
  byHorizon: Record<string, number>;
  byStatus: Record<string, number>;
  latestByHorizon: Record<string, string | null>;
}> {
  const [total, byHorizon, byStatus] = await Promise.all([
    DatasetVersionModel.countDocuments(),
    DatasetVersionModel.aggregate([
      { $group: { _id: '$horizon', count: { $sum: 1 } } },
    ]),
    DatasetVersionModel.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ]);
  
  const horizonCounts: Record<string, number> = {};
  byHorizon.forEach(h => { horizonCounts[h._id] = h.count; });
  
  const statusCounts: Record<string, number> = {};
  byStatus.forEach(s => { statusCounts[s._id] = s.count; });
  
  // Get latest for each horizon
  const latest7d = await DatasetVersionModel.findLatestFrozen('7d');
  const latest30d = await DatasetVersionModel.findLatestFrozen('30d');
  
  return {
    total,
    byHorizon: horizonCounts,
    byStatus: statusCounts,
    latestByHorizon: {
      '7d': latest7d?.datasetVersion || null,
      '30d': latest30d?.datasetVersion || null,
    },
  };
}

/**
 * Count new samples since last dataset
 */
export async function countNewSamplesSinceDataset(
  horizon: Horizon,
  lastDatasetVersion?: string
): Promise<number> {
  let cutoffDate: Date | null = null;
  
  if (lastDatasetVersion) {
    const lastDataset = await DatasetVersionModel.findOne({ datasetVersion: lastDatasetVersion }).lean();
    if (lastDataset) {
      cutoffDate = lastDataset.latestSample;
    }
  }
  
  const query: any = {
    'quality.trainEligible': true,
    [`labels.verdicts.verdict_${horizon}`]: { $exists: true, $ne: null },
  };
  
  if (cutoffDate) {
    query.snapshotAt = { $gt: cutoffDate };
  }
  
  return LearningSampleModel.countDocuments(query);
}
