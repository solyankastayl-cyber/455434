/**
 * Build Scores Job
 * Calculates scores for addresses based on bundles, relations, signals
 * 
 * Key principle: Scores do NOT trigger signals
 * They are stable ratings that explain "who is who"
 * 
 * Frequency: every 60-90 seconds
 */
import { BundleModel } from '../core/bundles/bundles.model.js';
import { RelationModel } from '../core/relations/relations.model.js';
import { SignalModel } from '../core/signals/signals.model.js';
import { TransferModel } from '../core/transfers/transfers.model.js';
import { scoresService } from '../core/scores/scores.service.js';
import { ScoreWindow, ScoreSubjectType } from '../core/scores/scores.model.js';
import { SyncStateModel } from '../onchain/ethereum/sync_state.model.js';

// Sync key
const SYNC_KEY = 'build_scores';

// Windows to process
const WINDOWS: ScoreWindow[] = ['7d', '30d', '90d'];

// Window to milliseconds
const WINDOW_MS: Record<ScoreWindow, number> = {
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '90d': 90 * 24 * 60 * 60 * 1000,
};

// Batch size
const BATCH_SIZE = 100;

export interface BuildScoresResult {
  processedAddresses: number;
  scoresUpdated: number;
  duration: number;
  byWindow: Record<string, number>;
}

/**
 * Get active addresses from recent bundles
 */
async function getActiveAddresses(
  window: ScoreWindow,
  limit: number
): Promise<string[]> {
  const since = new Date(Date.now() - WINDOW_MS[window]);

  // Get unique addresses from bundles
  const fromAddresses = await BundleModel.distinct('from', {
    window,
    processedAt: { $gte: since },
  });

  const toAddresses = await BundleModel.distinct('to', {
    window,
    processedAt: { $gte: since },
  });

  // Combine and dedupe
  const allAddresses = [...new Set([...fromAddresses, ...toAddresses])];
  
  return allAddresses.slice(0, limit);
}

/**
 * Get metrics for a single address
 */
async function getAddressMetrics(
  address: string,
  window: ScoreWindow
): Promise<{
  bundles: Array<{ bundleType: string; intensityScore: number; confidence: number }>;
  relations: Array<{ densityScore: number; interactionCount: number }>;
  signals: Array<{ signalType: string; severityScore: number }>;
  transfers: Array<{ timestamp: Date }>;
}> {
  const since = new Date(Date.now() - WINDOW_MS[window]);
  const addr = address.toLowerCase();

  // Get bundles where address is involved
  const bundles = await BundleModel.find({
    $or: [{ from: addr }, { to: addr }],
    window,
  })
    .select('bundleType intensityScore confidence')
    .lean();

  // Get relations
  const relations = await RelationModel.find({
    $or: [{ from: addr }, { to: addr }],
    window,
  })
    .select('densityScore interactionCount')
    .lean();

  // Get signals
  const signals = await SignalModel.find({
    relatedAddresses: addr,
    triggeredAt: { $gte: since },
  })
    .select('signalType severityScore')
    .lean();

  // Get transfers
  const transfers = await TransferModel.find({
    $or: [{ from: addr }, { to: addr }],
    timestamp: { $gte: since },
  })
    .select('timestamp')
    .lean();

  return {
    bundles: bundles.map(b => ({
      bundleType: b.bundleType,
      intensityScore: b.intensityScore,
      confidence: b.confidence,
    })),
    relations: relations.map(r => ({
      densityScore: r.densityScore,
      interactionCount: r.interactionCount,
    })),
    signals: signals.map(s => ({
      signalType: s.signalType,
      severityScore: s.severityScore,
    })),
    transfers: transfers.map(t => ({
      timestamp: t.timestamp,
    })),
  };
}

/**
 * Process a batch of addresses for a specific window
 */
async function processBatch(
  addresses: string[],
  window: ScoreWindow
): Promise<number> {
  const items: Array<{
    subjectType: ScoreSubjectType;
    subjectId: string;
    window: ScoreWindow;
    metrics: {
      bundles: Array<{ bundleType: string; intensityScore: number; confidence: number }>;
      relations: Array<{ densityScore: number; interactionCount: number }>;
      signals: Array<{ signalType: string; severityScore: number }>;
      transfers: Array<{ timestamp: Date }>;
    };
  }> = [];

  for (const address of addresses) {
    const metrics = await getAddressMetrics(address, window);
    
    // Skip addresses with no activity
    if (metrics.bundles.length === 0 && metrics.relations.length === 0) {
      continue;
    }

    items.push({
      subjectType: 'address',
      subjectId: address,
      window,
      metrics,
    });
  }

  if (items.length === 0) return 0;

  return scoresService.bulkCalculate(items);
}

/**
 * Main job function
 */
export async function buildScores(): Promise<BuildScoresResult> {
  const startTime = Date.now();
  let totalProcessed = 0;
  let totalUpdated = 0;
  const byWindow: Record<string, number> = {};

  for (const window of WINDOWS) {
    // Get active addresses for this window
    const addresses = await getActiveAddresses(window, BATCH_SIZE * 5);
    
    if (addresses.length === 0) {
      byWindow[window] = 0;
      continue;
    }

    // Process in batches
    let windowUpdated = 0;
    for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
      const batch = addresses.slice(i, i + BATCH_SIZE);
      const updated = await processBatch(batch, window);
      windowUpdated += updated;
      totalProcessed += batch.length;
    }

    byWindow[window] = windowUpdated;
    totalUpdated += windowUpdated;
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
        },
      },
    },
    { upsert: true }
  );

  const duration = Date.now() - startTime;

  if (totalUpdated > 0) {
    console.log(
      `[Build Scores] Updated ${totalUpdated} scores for ${totalProcessed} addresses (${duration}ms)`
    );
    console.log(`[Build Scores] By window:`, byWindow);
  }

  return {
    processedAddresses: totalProcessed,
    scoresUpdated: totalUpdated,
    duration,
    byWindow,
  };
}

/**
 * Get job status
 */
export async function getBuildScoresStatus(): Promise<{
  totalScores: number;
  byTier: Record<string, number>;
  avgComposite: number;
  lastCalculated: string | null;
}> {
  const stats = await scoresService.getStats();
  return {
    totalScores: stats.totalScored,
    byTier: stats.byTier,
    avgComposite: stats.avgComposite,
    lastCalculated: stats.lastCalculated,
  };
}
