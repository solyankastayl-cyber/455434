/**
 * Bundles Service
 * Business logic for bundle classification
 * 
 * Key concept: Bundles interpret HOW capital moves
 * - relation = road (topology)
 * - bundle = traffic pattern (behavior)
 * 
 * Classification logic:
 * - Accumulation: high inflow, low outflow, growing density
 * - Distribution: high outflow, low inflow
 * - Flow: balanced bidirectional
 * - Wash: symmetric volume, short time lag
 * - Rotation: cyclic patterns
 */
import {
  bundlesRepository,
  BundleFilter,
  BundleSort,
  PaginationOptions,
} from './bundles.repository.js';
import { 
  IBundle, 
  BundleType, 
  BundleWindow
} from './bundles.model.js';
import { IRelation } from '../relations/relations.model.js';

/**
 * Format bundle for API response
 */
export function formatBundle(bundle: IBundle) {
  return {
    id: bundle._id.toString(),
    from: bundle.from,
    to: bundle.to,
    chain: bundle.chain,
    window: bundle.window,
    bundleType: bundle.bundleType,
    confidence: bundle.confidence,
    interactionCount: bundle.interactionCount,
    densityScore: bundle.densityScore,
    netflowRaw: bundle.netflowRaw,
    netflowDirection: bundle.netflowDirection,
    intensityScore: bundle.intensityScore,
    consistencyScore: bundle.consistencyScore,
    firstSeenAt: bundle.firstSeenAt,
    lastSeenAt: bundle.lastSeenAt,
    // Human-readable interpretation
    interpretation: getBundleInterpretation(bundle),
  };
}

/**
 * Get human-readable interpretation of bundle
 */
export function getBundleInterpretation(bundle: IBundle): string {
  const confidence = Math.round(bundle.confidence * 100);
  
  switch (bundle.bundleType) {
    case 'accumulation':
      return `Accumulation pattern (${confidence}% confidence): Address is receiving more than sending. Possible buying/collecting behavior.`;
    case 'distribution':
      return `Distribution pattern (${confidence}% confidence): Address is sending more than receiving. Possible selling/dispersing behavior.`;
    case 'flow':
      return `Flow pattern (${confidence}% confidence): Balanced bidirectional movement. Could be operational or liquidity provision.`;
    case 'wash':
      return `Wash trading pattern (${confidence}% confidence): Symmetric volume with short time lag. Potentially suspicious activity.`;
    case 'rotation':
      return `Rotation pattern (${confidence}% confidence): Cyclic movement detected. Could indicate trading strategy or fund rotation.`;
    default:
      return `Unknown pattern: Insufficient data for classification.`;
  }
}

/**
 * Classification thresholds
 */
const THRESHOLDS = {
  // Netflow ratio for accumulation/distribution
  ACCUMULATION_RATIO: 0.7,   // >70% inflow
  DISTRIBUTION_RATIO: 0.3,    // <30% inflow (>70% outflow)
  
  // Symmetry for wash trading
  WASH_SYMMETRY: 0.1,         // Within 10% volume match
  
  // Minimum interactions for confident classification
  MIN_INTERACTIONS: 3,
  
  // Confidence boost factors
  HIGH_DENSITY_BOOST: 0.1,
  CONSISTENCY_BOOST: 0.15,
};

/**
 * Classify bundle type from relation data
 */
export function classifyBundleType(
  forwardRelation: IRelation | null,  // A -> B
  reverseRelation: IRelation | null,  // B -> A
): { type: BundleType; confidence: number } {
  // Need at least one relation
  if (!forwardRelation && !reverseRelation) {
    return { type: 'unknown', confidence: 0 };
  }

  const forwardCount = forwardRelation?.interactionCount || 0;
  const reverseCount = reverseRelation?.interactionCount || 0;
  const totalCount = forwardCount + reverseCount;

  // Minimum interactions check
  if (totalCount < THRESHOLDS.MIN_INTERACTIONS) {
    return { type: 'unknown', confidence: 0.2 };
  }

  // Calculate flow ratio (forward / total)
  const forwardRatio = forwardCount / totalCount;

  // Parse volumes
  let forwardVolume = 0n;
  let reverseVolume = 0n;
  try {
    forwardVolume = BigInt(forwardRelation?.volumeRaw || '0');
    reverseVolume = BigInt(reverseRelation?.volumeRaw || '0');
  } catch {
    // Keep as 0
  }

  // Check for WASH TRADING first (most suspicious)
  if (forwardCount > 0 && reverseCount > 0) {
    const volumeDiff = forwardVolume > reverseVolume 
      ? forwardVolume - reverseVolume 
      : reverseVolume - forwardVolume;
    const maxVolume = forwardVolume > reverseVolume ? forwardVolume : reverseVolume;
    
    if (maxVolume > 0n) {
      const symmetry = 1 - Number(volumeDiff * 100n / maxVolume) / 100;
      
      if (symmetry > (1 - THRESHOLDS.WASH_SYMMETRY)) {
        // High symmetry = potential wash trading
        const confidence = Math.min(0.9, 0.5 + symmetry * 0.4);
        return { type: 'wash', confidence };
      }
    }
  }

  // Check for ACCUMULATION (more receiving than sending)
  if (forwardRatio < THRESHOLDS.DISTRIBUTION_RATIO) {
    // Target address (to) is accumulating
    const confidence = Math.min(0.9, 0.5 + (1 - forwardRatio) * 0.4);
    return { type: 'accumulation', confidence };
  }

  // Check for DISTRIBUTION (more sending than receiving)
  if (forwardRatio > THRESHOLDS.ACCUMULATION_RATIO) {
    // Source address (from) is distributing
    const confidence = Math.min(0.9, 0.5 + forwardRatio * 0.4);
    return { type: 'distribution', confidence };
  }

  // Check for ROTATION (cyclic, with time patterns)
  // For now, simple heuristic: bidirectional with decent activity
  if (forwardCount >= 2 && reverseCount >= 2) {
    const avgDensity = ((forwardRelation?.densityScore || 0) + 
                        (reverseRelation?.densityScore || 0)) / 2;
    if (avgDensity > 1) {
      return { type: 'rotation', confidence: 0.6 };
    }
  }

  // Default: FLOW (balanced bidirectional)
  const balanceScore = 1 - Math.abs(forwardRatio - 0.5) * 2;
  const confidence = Math.min(0.85, 0.5 + balanceScore * 0.35);
  return { type: 'flow', confidence };
}

/**
 * Calculate consistency score
 * How regular/consistent is the activity pattern
 */
export function calculateConsistencyScore(
  forwardRelation: IRelation | null,
  reverseRelation: IRelation | null,
): number {
  const relations = [forwardRelation, reverseRelation].filter(Boolean) as IRelation[];
  
  if (relations.length === 0) return 0;

  // Calculate based on interaction spread over time
  let totalScore = 0;
  
  for (const rel of relations) {
    const daySpan = Math.max(
      1,
      (rel.lastSeenAt.getTime() - rel.firstSeenAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    const avgInteractionsPerDay = rel.interactionCount / daySpan;
    
    // Higher consistency = more regular activity
    // Normalize to 0-1 scale
    const consistency = Math.min(1, avgInteractionsPerDay / 10);
    totalScore += consistency;
  }

  return totalScore / relations.length;
}

/**
 * Bundles Service Class
 */
export class BundlesService {
  /**
   * Get bundle by ID
   */
  async getById(id: string): Promise<IBundle | null> {
    return bundlesRepository.findById(id);
  }

  /**
   * Get bundle for corridor
   */
  async getCorridor(
    from: string,
    to: string,
    window: BundleWindow = '7d'
  ): Promise<IBundle | null> {
    return bundlesRepository.findByCorridor(from, to, window);
  }

  /**
   * Get active bundles (high intensity)
   */
  async getActive(
    options: {
      window?: BundleWindow;
      bundleType?: BundleType;
      minIntensity?: number;
      minConfidence?: number;
      limit?: number;
    } = {}
  ): Promise<IBundle[]> {
    return bundlesRepository.findActive(options.window, options);
  }

  /**
   * Get bundles for address
   */
  async getForAddress(
    address: string,
    options: {
      window?: BundleWindow;
      direction?: 'in' | 'out' | 'both';
      bundleType?: BundleType;
      limit?: number;
    } = {}
  ): Promise<{
    bundles: IBundle[];
    summary: {
      totalBundles: number;
      accumulating: number;
      distributing: number;
      flowing: number;
      suspicious: number;
    };
  }> {
    const bundles = await bundlesRepository.findForAddress(address, options);

    // Calculate summary
    let accumulating = 0;
    let distributing = 0;
    let flowing = 0;
    let suspicious = 0;

    bundles.forEach((b) => {
      switch (b.bundleType) {
        case 'accumulation':
          accumulating++;
          break;
        case 'distribution':
          distributing++;
          break;
        case 'flow':
        case 'rotation':
          flowing++;
          break;
        case 'wash':
          suspicious++;
          break;
      }
    });

    return {
      bundles,
      summary: {
        totalBundles: bundles.length,
        accumulating,
        distributing,
        flowing,
        suspicious,
      },
    };
  }

  /**
   * Query bundles with filters
   */
  async query(
    filter: BundleFilter,
    sort?: BundleSort,
    pagination?: PaginationOptions
  ): Promise<{
    bundles: IBundle[];
    total: number;
  }> {
    return bundlesRepository.findMany(filter, sort, pagination);
  }

  /**
   * Get statistics
   */
  async getStats(): Promise<{
    totalBundles: number;
    byType: Record<string, number>;
    byWindow: Record<string, number>;
    avgIntensity: number;
    avgConfidence: number;
  }> {
    return bundlesRepository.getStats();
  }
}

// Export singleton instance
export const bundlesService = new BundlesService();
