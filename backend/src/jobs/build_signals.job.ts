/**
 * Build Signals Job
 * Detects changes in bundles and generates signals
 * 
 * Key logic:
 * - Compare current bundle state with previous
 * - If type/intensity/direction changed → emit signal
 * - NOT on every block, but on CHANGE events
 * 
 * This is what makes the system EVENT-DRIVEN
 */
import { BundleModel, IBundle, BundleType, BundleWindow } from '../core/bundles/bundles.model.js';
import { signalsRepository } from '../core/signals/signals.repository.js';
import { SignalType } from '../core/signals/signals.model.js';
import { SyncStateModel } from '../onchain/ethereum/sync_state.model.js';

// Sync key for tracking last processed bundle
const SYNC_KEY = 'build_signals';

// Windows to process
const WINDOWS: BundleWindow[] = ['1d', '7d', '30d'];

// Thresholds for signal generation
const THRESHOLDS = {
  // Intensity change threshold (percentage)
  INTENSITY_SPIKE_THRESHOLD: 0.5,  // 50% increase
  INTENSITY_DROP_THRESHOLD: 0.3,   // 30% decrease
  
  // Minimum confidence for signal
  MIN_CONFIDENCE: 0.5,
};

// Dedup intervals by signal type (in minutes)
const SIGNAL_DEDUP_INTERVALS: Record<SignalType, number> = {
  'new_corridor': 24 * 60,           // 24h
  'accumulation_start': 12 * 60,     // 12h
  'accumulation_end': 12 * 60,
  'distribution_start': 12 * 60,
  'distribution_end': 12 * 60,
  'bundle_change': 12 * 60,
  'intensity_spike': 6 * 60,         // 6h
  'intensity_drop': 6 * 60,
  'wash_detected': 24 * 60,          // 24h
  'wash_cleared': 24 * 60,
  'rotation_shift': 12 * 60,
  'corridor_dormant': 24 * 60,
};

const DEFAULT_DEDUP_MINUTES = 60;

// Track previous bundle states in memory (for change detection)
const bundleStateCache = new Map<string, {
  bundleType: BundleType;
  intensityScore: number;
  confidence: number;
  lastChecked: Date;
}>();

export interface BuildSignalsResult {
  processedBundles: number;
  signalsGenerated: number;
  duration: number;
  byType: Record<string, number>;
}

/**
 * Get bundle cache key
 */
function getBundleCacheKey(bundle: IBundle): string {
  return `${bundle.from}:${bundle.to}:${bundle.window}`;
}

/**
 * Determine signal type from bundle change
 */
function determineSignalType(
  prevType: BundleType | null,
  newType: BundleType,
  prevIntensity: number,
  newIntensity: number
): SignalType | null {
  // Check for wash trading detection (highest priority)
  if (newType === 'wash' && prevType !== 'wash') {
    return 'wash_detected';
  }
  if (prevType === 'wash' && newType !== 'wash') {
    return 'wash_cleared';
  }

  // Check for intensity spike/drop
  if (prevIntensity > 0) {
    const intensityChange = (newIntensity - prevIntensity) / prevIntensity;
    
    if (intensityChange >= THRESHOLDS.INTENSITY_SPIKE_THRESHOLD) {
      return 'intensity_spike';
    }
    if (intensityChange <= -THRESHOLDS.INTENSITY_DROP_THRESHOLD) {
      return 'intensity_drop';
    }
  }

  // Check for bundle type changes
  if (prevType !== newType) {
    // Specific state transitions
    if (newType === 'accumulation') {
      return 'accumulation_start';
    }
    if (newType === 'distribution') {
      return 'distribution_start';
    }
    if (prevType === 'accumulation') {
      return 'accumulation_end';
    }
    if (prevType === 'distribution') {
      return 'distribution_end';
    }
    if (newType === 'rotation' || prevType === 'rotation') {
      return 'rotation_shift';
    }

    // Generic bundle change
    return 'bundle_change';
  }

  return null;
}

/**
 * Process a single bundle for signal detection
 */
async function processBundleForSignals(
  bundle: IBundle,
  signalsByType: Record<string, number>
): Promise<boolean> {
  const cacheKey = getBundleCacheKey(bundle);
  const prevState = bundleStateCache.get(cacheKey);

  // Update cache
  bundleStateCache.set(cacheKey, {
    bundleType: bundle.bundleType,
    intensityScore: bundle.intensityScore,
    confidence: bundle.confidence,
    lastChecked: new Date(),
  });

  // Skip if no previous state (first time seeing this bundle)
  if (!prevState) {
    // Generate "new corridor" signal for new high-confidence bundles
    if (bundle.confidence >= THRESHOLDS.MIN_CONFIDENCE && bundle.intensityScore > 0.5) {
      const entityId = `${bundle.from}:${bundle.to}`;
      const dedupMinutes = SIGNAL_DEDUP_INTERVALS['new_corridor'] ?? DEFAULT_DEDUP_MINUTES;
      
      // Check for duplicate
      const exists = await signalsRepository.existsRecent(
        entityId,
        'new_corridor',
        bundle.window,
        dedupMinutes
      );

      if (!exists) {
        await signalsRepository.create({
          entityType: 'corridor',
          entityId,
          signalType: 'new_corridor',
          newBundleType: bundle.bundleType,
          newIntensity: bundle.intensityScore,
          confidence: bundle.confidence,
          window: bundle.window,
          chain: bundle.chain,
          relatedAddresses: [bundle.from, bundle.to],
        });

        signalsByType['new_corridor'] = (signalsByType['new_corridor'] || 0) + 1;
        return true;
      }
    }
    return false;
  }

  // Determine if a signal should be generated
  const signalType = determineSignalType(
    prevState.bundleType,
    bundle.bundleType,
    prevState.intensityScore,
    bundle.intensityScore
  );

  if (!signalType) {
    return false;
  }

  // Check confidence threshold
  if (bundle.confidence < THRESHOLDS.MIN_CONFIDENCE) {
    return false;
  }

  // Check for duplicate signal
  const entityId = `${bundle.from}:${bundle.to}`;
  const dedupMinutes = SIGNAL_DEDUP_INTERVALS[signalType] ?? DEFAULT_DEDUP_MINUTES;
  const exists = await signalsRepository.existsRecent(
    entityId,
    signalType,
    bundle.window,
    dedupMinutes
  );

  if (exists) {
    return false;
  }

  // Create signal
  await signalsRepository.create({
    entityType: 'corridor',
    entityId,
    signalType,
    prevBundleType: prevState.bundleType,
    newBundleType: bundle.bundleType,
    prevIntensity: prevState.intensityScore,
    newIntensity: bundle.intensityScore,
    confidence: bundle.confidence,
    window: bundle.window,
    chain: bundle.chain,
    relatedAddresses: [bundle.from, bundle.to],
  });

  signalsByType[signalType] = (signalsByType[signalType] || 0) + 1;
  return true;
}

/**
 * Build signals from bundles
 * Main job function
 */
export async function buildSignals(): Promise<BuildSignalsResult> {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalSignals = 0;
  const signalsByType: Record<string, number> = {};

  // Get last processed time
  const syncState = await SyncStateModel.findOne({ key: SYNC_KEY });
  const lastProcessed = syncState?.lastProcessedAt || new Date(0);

  // Process bundles updated since last run
  for (const window of WINDOWS) {
    // Get recently updated bundles
    const bundles = await BundleModel.find({
      window,
      processedAt: { $gt: lastProcessed },
    })
      .sort({ processedAt: 1 })
      .limit(500)
      .lean<IBundle[]>();

    for (const bundle of bundles) {
      const generated = await processBundleForSignals(bundle, signalsByType);
      totalProcessed++;
      if (generated) totalSignals++;
    }
  }

  // Update sync state
  await SyncStateModel.updateOne(
    { key: SYNC_KEY },
    { 
      $set: { 
        lastProcessedAt: new Date(),
        metadata: { lastProcessedCount: totalProcessed }
      } 
    },
    { upsert: true }
  );

  const duration = Date.now() - startTime;

  if (totalSignals > 0) {
    console.log(
      `[Build Signals] Generated ${totalSignals} signals from ${totalProcessed} bundles (${duration}ms)`
    );
    console.log(`[Build Signals] By type:`, signalsByType);
  }

  return {
    processedBundles: totalProcessed,
    signalsGenerated: totalSignals,
    duration,
    byType: signalsByType,
  };
}

/**
 * Get build job status
 */
export async function getBuildSignalsStatus(): Promise<{
  totalSignals: number;
  last24h: number;
  unacknowledged: number;
  byType: Record<string, number>;
}> {
  const stats = await signalsRepository.getStats();
  return {
    totalSignals: stats.totalSignals,
    last24h: stats.last24h,
    unacknowledged: stats.unacknowledged,
    byType: stats.byType,
  };
}

/**
 * Clear state cache (for testing)
 */
export function clearSignalStateCache(): void {
  bundleStateCache.clear();
}
