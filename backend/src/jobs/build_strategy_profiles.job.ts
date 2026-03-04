/**
 * Build Strategy Profiles Job
 * Classifies trading strategies for addresses based on bundles, scores, signals
 * 
 * Frequency: every 5 minutes (strategies are not high-frequency)
 * 
 * Algorithm:
 * 1. Get addresses with updated bundles/scores
 * 2. Build metrics snapshot (30d / 7d)
 * 3. Classify strategy
 * 4. Upsert StrategyProfile
 * 5. If strategyType changed → can emit signal (strategy_shift) - handled separately
 */
import { BundleModel } from '../core/bundles/bundles.model.js';
import { ScoreModel } from '../core/scores/scores.model.js';
import { SignalModel } from '../core/signals/signals.model.js';
import { RelationModel } from '../core/relations/relations.model.js';
import { 
  strategyProfilesService, 
  ClassificationInput 
} from '../core/strategies/strategy_profiles.service.js';
import { StrategyProfileModel, StrategyType } from '../core/strategies/strategy_profiles.model.js';
import { SyncStateModel } from '../onchain/ethereum/sync_state.model.js';

// Sync key
const SYNC_KEY = 'build_strategy_profiles';

// Batch size
const BATCH_SIZE = 100;

// 30 days in ms
const WINDOW_30D_MS = 30 * 24 * 60 * 60 * 1000;

export interface BuildStrategyProfilesResult {
  processedAddresses: number;
  profilesUpdated: number;
  strategyShifts: number;
  duration: number;
  byStrategy: Record<string, number>;
}

/**
 * Get active addresses from recent scores
 */
async function getActiveAddresses(limit: number): Promise<string[]> {
  // Get addresses with scores updated recently
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000); // 2 hours ago

  const result = await ScoreModel.find({
    subjectType: 'address',
    window: '30d',
    calculatedAt: { $gte: cutoff },
  })
    .select('subjectId')
    .limit(limit)
    .lean();

  return [...new Set(result.map((r: { subjectId: string }) => r.subjectId))];
}

/**
 * Get metrics for an address to classify strategy
 */
async function getClassificationInput(
  address: string
): Promise<ClassificationInput | null> {
  const addr = address.toLowerCase();
  const since = new Date(Date.now() - WINDOW_30D_MS);

  // Get bundles breakdown
  const bundles = await BundleModel.find({
    $or: [{ from: addr }, { to: addr }],
    window: '30d',
  })
    .select('bundleType')
    .lean();

  if (bundles.length === 0) {
    return null;
  }

  // Calculate bundle ratios
  const bundleCount = bundles.length;
  const bundleTypes = bundles.map(b => b.bundleType);
  
  const accumulationCount = bundleTypes.filter(t => t === 'accumulation').length;
  const distributionCount = bundleTypes.filter(t => t === 'distribution').length;
  const rotationCount = bundleTypes.filter(t => t === 'rotation').length;
  const washCount = bundleTypes.filter(t => t === 'wash').length;
  const flowCount = bundleTypes.filter(t => t === 'flow').length;

  // Get score data
  const score = await ScoreModel.findOne({
    subjectType: 'address',
    subjectId: addr,
    window: '30d',
  }).lean();

  // Get signal data (intensity spikes)
  const signals = await SignalModel.find({
    relatedAddresses: addr,
    triggeredAt: { $gte: since },
  })
    .select('signalType')
    .lean();

  const intensitySpikeCount = signals.filter(
    s => s.signalType === 'intensity_spike'
  ).length;

  // Get preferred assets from relations
  const relations = await RelationModel.aggregate([
    {
      $match: {
        $or: [{ from: addr }, { to: addr }],
        window: '30d',
      },
    },
    {
      $group: {
        _id: null,
        assets: { $addToSet: '$from' },
        assets2: { $addToSet: '$to' },
      },
    },
  ]);

  const allAssets = relations.length > 0
    ? [...new Set([
        ...(relations[0].assets || []),
        ...(relations[0].assets2 || []),
      ])].filter(a => a !== addr)
    : [];

  // Get existing profile for previous strategy
  const existingProfile = await StrategyProfileModel.findOne({
    address: addr,
    chain: 'ethereum',
  }).lean();

  // Estimate avg holding time (simplified - based on window preference)
  // In reality, this would come from transfer timestamp analysis
  let avgHoldingTimeHours = 72; // default
  if (score?.breakdown?.activeDaysRatio) {
    // Higher active days = likely shorter holding
    avgHoldingTimeHours = score.breakdown.activeDaysRatio < 0.3 ? 168 : 
                          score.breakdown.activeDaysRatio < 0.7 ? 72 : 24;
  }

  return {
    accumulationRatio: accumulationCount / bundleCount,
    distributionRatio: distributionCount / bundleCount,
    rotationRatio: rotationCount / bundleCount,
    washRatio: washCount / bundleCount,
    flowRatio: flowCount / bundleCount,
    
    consistencyScore: score?.consistencyScore || 50,
    intensityScore: score?.intensityScore || 50,
    behaviorScore: score?.behaviorScore || 50,
    riskScore: score?.riskScore || 50,
    influenceScore: score?.influenceScore || 50,
    avgDensity: score?.breakdown?.avgDensity || 0,
    
    intensitySpikeCount,
    avgHoldingTimeHours,
    preferredAssets: allAssets.slice(0, 10),
    
    previousStrategy: existingProfile?.strategyType as StrategyType || null,
    strategyChangesLast30d: existingProfile?.strategyChangesLast30d || 0,
  };
}

/**
 * Main job function
 */
export async function buildStrategyProfiles(): Promise<BuildStrategyProfilesResult> {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalStrategyShifts = 0;
  const byStrategy: Record<string, number> = {};

  // Get active addresses
  const addresses = await getActiveAddresses(BATCH_SIZE * 5);

  if (addresses.length === 0) {
    return {
      processedAddresses: 0,
      profilesUpdated: 0,
      strategyShifts: 0,
      duration: Date.now() - startTime,
      byStrategy: {},
    };
  }

  // Process in batches
  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const items: Array<{
      address: string;
      input: ClassificationInput;
      chain?: string;
    }> = [];

    for (const address of batch) {
      const input = await getClassificationInput(address);
      if (input) {
        items.push({ address, input, chain: 'ethereum' });
        totalProcessed++;
      }
    }

    if (items.length > 0) {
      const result = await strategyProfilesService.bulkCalculate(items);
      totalUpdated += result.updated;
      totalStrategyShifts += result.strategyShifts;

      // Count by strategy
      for (const item of items) {
        const classification = strategyProfilesService.classifyStrategy(item.input);
        byStrategy[classification.strategyType] = 
          (byStrategy[classification.strategyType] || 0) + 1;
      }
    }
  }

  // Update sync state
  await SyncStateModel.updateOne(
    { key: SYNC_KEY },
    {
      $set: {
        lastProcessedAt: new Date(),
        metadata: {
          lastProcessedCount: totalProcessed,
          lastUpdatedCount: totalUpdated,
          lastStrategyShifts: totalStrategyShifts,
        },
      },
    },
    { upsert: true }
  );

  const duration = Date.now() - startTime;

  if (totalUpdated > 0) {
    console.log(
      `[Build Strategy Profiles] Updated ${totalUpdated} profiles ` +
      `for ${totalProcessed} addresses (${duration}ms)`
    );
    if (totalStrategyShifts > 0) {
      console.log(`[Build Strategy Profiles] Strategy shifts detected: ${totalStrategyShifts}`);
    }
    console.log(`[Build Strategy Profiles] By strategy:`, byStrategy);
  }

  return {
    processedAddresses: totalProcessed,
    profilesUpdated: totalUpdated,
    strategyShifts: totalStrategyShifts,
    duration,
    byStrategy,
  };
}

/**
 * Get job status
 */
export async function getBuildStrategyProfilesStatus(): Promise<{
  totalProfiles: number;
  byStrategy: Record<string, number>;
  avgConfidence: number;
  avgStability: number;
}> {
  const stats = await strategyProfilesService.getStats('ethereum');
  
  const byStrategy: Record<string, number> = {};
  for (const [type, data] of Object.entries(stats.byStrategy)) {
    byStrategy[type] = (data as { count: number }).count;
  }

  return {
    totalProfiles: stats.totalProfiles,
    byStrategy,
    avgConfidence: stats.avgConfidence,
    avgStability: stats.avgStability,
  };
}
