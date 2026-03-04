/**
 * Build Bundles Job
 * Classifies relations (L3) into bundles (L4)
 * 
 * Key logic:
 * - Take relations for each corridor
 * - Analyze forward + reverse relations
 * - Classify bundle type (accumulation, distribution, flow, wash, rotation)
 * - Calculate confidence and intensity scores
 * 
 * This is what adds INTELLIGENCE to the graph
 */
import { RelationModel, IRelation, RelationWindow } from '../core/relations/relations.model.js';
import { bundlesRepository } from '../core/bundles/bundles.repository.js';
import { 
  BundleType,
  BundleWindow 
} from '../core/bundles/bundles.model.js';
import {
  classifyBundleType,
  calculateConsistencyScore,
} from '../core/bundles/bundles.service.js';

// Windows to process
const WINDOWS: BundleWindow[] = ['1d', '7d', '30d'];

// Batch size for processing relations
const BATCH_SIZE = 500;

// Minimum density to consider for bundle analysis
const MIN_DENSITY = 0.1;

export interface BuildBundlesResult {
  processedPairs: number;
  bundlesCreated: number;
  bundlesUpdated: number;
  duration: number;
}

/**
 * Get unique address pairs from relations
 */
async function getUniquePairs(window: RelationWindow, skip: number = 0): Promise<Array<{ from: string; to: string }>> {
  const pairs = await RelationModel.aggregate([
    { $match: { window, densityScore: { $gte: MIN_DENSITY } } },
    { 
      $group: { 
        _id: { 
          // Normalize pair (always smaller address first for deduplication)
          pair: { 
            $cond: [
              { $lt: ['$from', '$to'] },
              { a: '$from', b: '$to' },
              { a: '$to', b: '$from' }
            ]
          }
        }
      }
    },
    { $skip: skip },
    { $limit: BATCH_SIZE },
    {
      $project: {
        from: '$_id.pair.a',
        to: '$_id.pair.b',
        _id: 0
      }
    }
  ]);

  return pairs;
}

/**
 * Get relations for a pair
 */
async function getRelationsForPair(
  from: string,
  to: string,
  window: RelationWindow
): Promise<{
  forward: IRelation | null;
  reverse: IRelation | null;
}> {
  const [forward, reverse] = await Promise.all([
    RelationModel.findOne({ from, to, window }).lean<IRelation>(),
    RelationModel.findOne({ from: to, to: from, window }).lean<IRelation>(),
  ]);

  return { forward, reverse };
}

/**
 * Build bundles from relations
 * Main job function
 */
export async function buildBundles(): Promise<BuildBundlesResult> {
  const startTime = Date.now();

  let totalPairs = 0;
  let totalCreated = 0;
  let totalUpdated = 0;

  // Process each window
  for (const window of WINDOWS) {
    let skip = 0;
    let hasMore = true;

    while (hasMore) {
      // Get batch of unique pairs
      const pairs = await getUniquePairs(window, skip);

      if (pairs.length === 0) {
        hasMore = false;
        continue;
      }

      console.log(`[Build Bundles] Processing ${pairs.length} pairs for window ${window}`);

      const bundlesToUpsert: Array<{
        from: string;
        to: string;
        chain: 'ethereum';
        window: BundleWindow;
        bundleType: BundleType;
        confidence: number;
        interactionCount: number;
        densityScore: number;
        netflowRaw: string;
        consistencyScore: number;
        firstSeenAt: Date;
        lastSeenAt: Date;
        sourceRelationIds: string[];
      }> = [];

      // Process each pair
      for (const pair of pairs) {
        const { forward, reverse } = await getRelationsForPair(pair.from, pair.to, window);

        // Skip if no significant relations
        if (!forward && !reverse) continue;

        // Classify bundle type
        const { type, confidence } = classifyBundleType(forward, reverse);

        // Calculate metrics
        const forwardCount = forward?.interactionCount || 0;
        const reverseCount = reverse?.interactionCount || 0;
        const totalCount = forwardCount + reverseCount;

        const forwardDensity = forward?.densityScore || 0;
        const reverseDensity = reverse?.densityScore || 0;
        const avgDensity = (forwardDensity + reverseDensity) / 2;

        // Calculate netflow
        let netflowRaw = '0';
        try {
          const forwardVolume = BigInt(forward?.volumeRaw || '0');
          const reverseVolume = BigInt(reverse?.volumeRaw || '0');
          netflowRaw = (reverseVolume - forwardVolume).toString(); // Positive = net inflow to 'to' address
        } catch {
          // Keep as '0'
        }

        // Calculate consistency
        const consistencyScore = calculateConsistencyScore(forward, reverse);

        // Determine time bounds
        const times = [
          forward?.firstSeenAt,
          forward?.lastSeenAt,
          reverse?.firstSeenAt,
          reverse?.lastSeenAt,
        ].filter(Boolean) as Date[];

        const firstSeenAt = new Date(Math.min(...times.map(t => t.getTime())));
        const lastSeenAt = new Date(Math.max(...times.map(t => t.getTime())));

        // Collect source relation IDs
        const sourceRelationIds = [
          forward?._id?.toString(),
          reverse?._id?.toString(),
        ].filter(Boolean) as string[];

        bundlesToUpsert.push({
          from: pair.from,
          to: pair.to,
          chain: 'ethereum',
          window,
          bundleType: type,
          confidence,
          interactionCount: totalCount,
          densityScore: avgDensity,
          netflowRaw,
          consistencyScore,
          firstSeenAt,
          lastSeenAt,
          sourceRelationIds,
        });
      }

      // Bulk upsert bundles
      if (bundlesToUpsert.length > 0) {
        const result = await bundlesRepository.bulkUpsert(bundlesToUpsert);
        totalCreated += result.upsertedCount;
        totalUpdated += result.modifiedCount;
      }

      totalPairs += pairs.length;
      skip += BATCH_SIZE;

      // Check if we got less than batch size (no more data)
      if (pairs.length < BATCH_SIZE) {
        hasMore = false;
      }
    }
  }

  const duration = Date.now() - startTime;

  if (totalPairs > 0) {
    console.log(
      `[Build Bundles] Processed ${totalPairs} pairs: ` +
      `${totalCreated} created, ${totalUpdated} updated (${duration}ms)`
    );
  }

  return {
    processedPairs: totalPairs,
    bundlesCreated: totalCreated,
    bundlesUpdated: totalUpdated,
    duration,
  };
}

/**
 * Get build job status
 */
export async function getBuildBundlesStatus(): Promise<{
  totalBundles: number;
  byType: Record<string, number>;
  byWindow: Record<string, number>;
}> {
  const stats = await bundlesRepository.getStats();
  return {
    totalBundles: stats.totalBundles,
    byType: stats.byType,
    byWindow: stats.byWindow,
  };
}
