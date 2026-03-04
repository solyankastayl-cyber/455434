/**
 * Token Ranking Service v2 (Stage C + D Integration)
 * 
 * Rules-based ranking engine with Engine confidence integration
 * Sorts tokens into BUY / WATCH / SELL buckets
 * 
 * Scoring formula (v2):
 *   compositeScore = 
 *     marketCapScore * 0.25 +
 *     volumeScore * 0.20 +
 *     momentumScore * 0.20 +
 *     engineConfidence * 0.35  ← Main contribution
 * 
 * Safety constraints:
 *   - engineConfidence capped at ±15 points impact
 *   - Engine alone cannot move SELL → BUY
 * 
 * Bucket thresholds:
 *   BUY:   score >= 70
 *   WATCH: 40 <= score < 70
 *   SELL:  score < 40
 */
import { TokenUniverseModel } from '../token_universe/token_universe.model.js';
import { TokenRankingModel, BucketType } from './ranking.model.js';
import { TokenAnalysisModel } from '../token_runner/token_analysis.model.js';

// ============================================================
// CONFIGURATION
// ============================================================

interface RankingConfig {
  // Score weights (must sum to 1.0)
  weights: {
    marketCap: number;
    volume: number;
    momentum: number;
    engineConfidence: number;
  };
  
  // Bucket thresholds
  thresholds: {
    buy: number;
    watch: number;
  };
  
  // Safety caps
  engineConfidenceCap: number;  // Max ±points from engine
  
  // Limits
  maxTokensPerBucket: number;
}

// V2 Config: Engine has more weight but capped
const DEFAULT_CONFIG: RankingConfig = {
  weights: {
    marketCap: 0.25,
    volume: 0.20,
    momentum: 0.20,
    engineConfidence: 0.35,  // Main contribution
  },
  thresholds: {
    buy: 70,
    watch: 40,
  },
  engineConfidenceCap: 15,  // Max ±15 points
  maxTokensPerBucket: 50,
};

// ============================================================
// MAIN RANKING FUNCTION
// ============================================================

export interface RankingResult {
  computed: number;
  buckets: {
    BUY: number;
    WATCH: number;
    SELL: number;
  };
  withEngineData: number;
  withoutEngineData: number;
  duration_ms: number;
}

/**
 * Compute rankings for all active tokens (v2 with Engine integration)
 */
export async function computeTokenRankings(
  config: RankingConfig = DEFAULT_CONFIG
): Promise<RankingResult> {
  console.log('[Ranking v2] Starting token ranking computation...');
  const startTime = Date.now();
  
  try {
    // 1. Fetch all active tokens
    const tokens = await TokenUniverseModel.find({ active: true })
      .select('symbol name contractAddress chainId marketCap volume24h priceUsd priceChange24h imageUrl')
      .lean();
    
    console.log(`[Ranking v2] Processing ${tokens.length} active tokens`);
    
    if (tokens.length === 0) {
      return {
        computed: 0,
        buckets: { BUY: 0, WATCH: 0, SELL: 0 },
        withEngineData: 0,
        withoutEngineData: 0,
        duration_ms: Date.now() - startTime,
      };
    }
    
    // 2. Fetch Engine analyses for these tokens
    const analyses = await TokenAnalysisModel.find({
      contractAddress: { $in: tokens.map(t => t.contractAddress.toLowerCase()) },
      status: 'completed',
    }).lean();
    
    const analysisMap = new Map(
      analyses.map(a => [a.contractAddress.toLowerCase(), a])
    );
    
    console.log(`[Ranking v2] Found ${analyses.length} Engine analyses`);
    
    // 3. Calculate normalization bounds
    const marketCaps = tokens.map(t => t.marketCap || 0);
    const volumes = tokens.map(t => t.volume24h || 0);
    const priceChanges = tokens.map(t => t.priceChange24h || 0);
    
    const bounds = {
      marketCap: { min: Math.min(...marketCaps), max: Math.max(...marketCaps) },
      volume: { min: Math.min(...volumes), max: Math.max(...volumes) },
      priceChange: { min: Math.min(...priceChanges), max: Math.max(...priceChanges) },
    };
    
    // 4. Compute scores for each token
    let withEngineData = 0;
    let withoutEngineData = 0;
    
    const scoredTokens = tokens.map(token => {
      // Get Engine analysis if available
      const analysis = analysisMap.get(token.contractAddress.toLowerCase());
      
      if (analysis) {
        withEngineData++;
      } else {
        withoutEngineData++;
      }
      
      const scores = computeTokenScores(token, bounds, analysis, config);
      const compositeScore = computeCompositeScore(scores, config.weights);
      const bucket = determineBucket(compositeScore, config.thresholds, analysis);
      
      return {
        ...token,
        ...scores,
        compositeScore,
        bucket,
        hasEngineData: !!analysis,
      };
    });
    
    // 5. Sort by composite score (descending)
    scoredTokens.sort((a, b) => b.compositeScore - a.compositeScore);
    
    // 6. Assign global and bucket ranks
    const bucketCounters = { BUY: 0, WATCH: 0, SELL: 0 };
    
    const rankedTokens = scoredTokens.map((token, idx) => {
      const bucketRank = ++bucketCounters[token.bucket];
      
      return {
        symbol: token.symbol,
        name: token.name,
        contractAddress: token.contractAddress,
        chainId: token.chainId,
        marketCapScore: token.marketCapScore,
        volumeScore: token.volumeScore,
        momentumScore: token.momentumScore,
        engineConfidence: token.engineConfidence,
        engineRisk: token.engineRisk || 50,
        mlAdjustment: 0,
        compositeScore: token.compositeScore,
        bucket: token.bucket,
        bucketRank,
        globalRank: idx + 1,
        priceUsd: token.priceUsd || 0,
        priceChange24h: token.priceChange24h || 0,
        marketCap: token.marketCap || 0,
        volume24h: token.volume24h || 0,
        imageUrl: token.imageUrl,
        computedAt: new Date(),
        source: token.hasEngineData ? 'rules_with_engine' : 'rules',
      };
    });
    
    // 7. Upsert all rankings
    const bulkOps = rankedTokens.map(token => ({
      updateOne: {
        filter: { 
          contractAddress: token.contractAddress,
          chainId: token.chainId,
        },
        update: { $set: token },
        upsert: true,
      },
    }));
    
    if (bulkOps.length > 0) {
      await TokenRankingModel.bulkWrite(bulkOps);
    }
    
    const duration = Date.now() - startTime;
    console.log(`[Ranking v2] Computed ${rankedTokens.length} rankings in ${duration}ms`);
    console.log(`[Ranking v2] With Engine: ${withEngineData}, Without: ${withoutEngineData}`);
    console.log(`[Ranking v2] Buckets: BUY=${bucketCounters.BUY}, WATCH=${bucketCounters.WATCH}, SELL=${bucketCounters.SELL}`);
    
    return {
      computed: rankedTokens.length,
      buckets: bucketCounters,
      withEngineData,
      withoutEngineData,
      duration_ms: duration,
    };
  } catch (err: any) {
    console.error('[Ranking v2] Computation failed:', err);
    throw err;
  }
}

// ============================================================
// SCORING FUNCTIONS
// ============================================================

interface TokenScores {
  marketCapScore: number;
  volumeScore: number;
  momentumScore: number;
  engineConfidence: number;
  engineRisk?: number;
}

interface Bounds {
  marketCap: { min: number; max: number };
  volume: { min: number; max: number };
  priceChange: { min: number; max: number };
}

/**
 * Compute individual scores for a token
 */
function computeTokenScores(
  token: any, 
  bounds: Bounds, 
  analysis: any | null,
  config: RankingConfig
): TokenScores {
  // Market Cap Score (log scale normalization)
  const marketCapScore = normalizeLogScale(
    token.marketCap || 0,
    bounds.marketCap.min,
    bounds.marketCap.max
  );
  
  // Volume Score (log scale normalization)
  const volumeScore = normalizeLogScale(
    token.volume24h || 0,
    bounds.volume.min,
    bounds.volume.max
  );
  
  // Momentum Score (price change based)
  const momentumScore = normalizeMomentum(
    token.priceChange24h || 0,
    bounds.priceChange.min,
    bounds.priceChange.max
  );
  
  // Engine Confidence (from TokenAnalysis or default)
  let engineConfidence = 50; // Default neutral
  let engineRisk = 50;
  
  if (analysis) {
    // Use Engine analysis with capped contribution
    const rawConfidence = analysis.confidence || 50;
    
    // Cap the deviation from neutral (50)
    const deviation = rawConfidence - 50;
    const cappedDeviation = Math.max(-config.engineConfidenceCap, 
                                     Math.min(config.engineConfidenceCap, deviation));
    
    engineConfidence = 50 + cappedDeviation;
    engineRisk = analysis.risk || 50;
  }
  
  return {
    marketCapScore: Math.round(marketCapScore * 100) / 100,
    volumeScore: Math.round(volumeScore * 100) / 100,
    momentumScore: Math.round(momentumScore * 100) / 100,
    engineConfidence: Math.round(engineConfidence * 100) / 100,
    engineRisk,
  };
}

/**
 * Normalize value using log scale (better for large ranges)
 */
function normalizeLogScale(value: number, min: number, max: number): number {
  if (max <= min || value <= 0) return 0;
  
  const logValue = Math.log10(Math.max(value, 1));
  const logMin = Math.log10(Math.max(min, 1));
  const logMax = Math.log10(Math.max(max, 1));
  
  if (logMax <= logMin) return 50;
  
  const normalized = ((logValue - logMin) / (logMax - logMin)) * 100;
  return Math.max(0, Math.min(100, normalized));
}

/**
 * Normalize momentum (price change)
 */
function normalizeMomentum(priceChange: number, min: number, max: number): number {
  const clampedChange = Math.max(-50, Math.min(50, priceChange));
  const normalized = ((clampedChange + 50) / 100) * 100;
  return Math.max(0, Math.min(100, normalized));
}

/**
 * Compute weighted composite score
 */
function computeCompositeScore(
  scores: TokenScores,
  weights: RankingConfig['weights']
): number {
  const composite = 
    scores.marketCapScore * weights.marketCap +
    scores.volumeScore * weights.volume +
    scores.momentumScore * weights.momentum +
    scores.engineConfidence * weights.engineConfidence;
  
  return Math.round(composite * 100) / 100;
}

/**
 * Determine bucket based on composite score
 * Safety: Engine alone cannot move SELL → BUY
 */
function determineBucket(
  score: number,
  thresholds: RankingConfig['thresholds'],
  analysis: any | null
): BucketType {
  // Base bucket from score
  let bucket: BucketType;
  
  if (score >= thresholds.buy) {
    bucket = 'BUY';
  } else if (score >= thresholds.watch) {
    bucket = 'WATCH';
  } else {
    bucket = 'SELL';
  }
  
  // Safety check: If Engine alone is pushing to BUY but base metrics are weak
  // This prevents engine from dominating
  if (bucket === 'BUY' && analysis) {
    // Check if base score (without engine) would be SELL
    const baseScore = score - (analysis.confidence - 50) * 0.35;
    if (baseScore < thresholds.watch) {
      // Downgrade to WATCH - engine can't push SELL to BUY
      bucket = 'WATCH';
    }
  }
  
  return bucket;
}

// ============================================================
// QUERY FUNCTIONS
// ============================================================

/**
 * Get rankings by bucket
 */
export async function getRankingsByBucket(bucket: BucketType, limit = 50) {
  const rankings = await TokenRankingModel.find({ bucket })
    .sort({ bucketRank: 1 })
    .limit(limit)
    .select('-_id symbol name contractAddress chainId compositeScore bucketRank globalRank priceUsd priceChange24h marketCap volume24h imageUrl engineConfidence actorSignalScore engineMode coverage coverageLevel signalFreshness isUnstable stabilityPenalty computedAt source')
    .lean();
  
  return rankings;
}

/**
 * Get all buckets summary
 */
export async function getBucketsSummary() {
  const [buy, watch, sell, lastComputed, withEngine] = await Promise.all([
    TokenRankingModel.countDocuments({ bucket: 'BUY' }),
    TokenRankingModel.countDocuments({ bucket: 'WATCH' }),
    TokenRankingModel.countDocuments({ bucket: 'SELL' }),
    TokenRankingModel.findOne().sort({ computedAt: -1 }).select('computedAt').lean(),
    TokenRankingModel.countDocuments({ source: 'rules_with_engine' }),
  ]);
  
  return {
    BUY: buy,
    WATCH: watch,
    SELL: sell,
    total: buy + watch + sell,
    withEngineData: withEngine,
    lastComputed: lastComputed?.computedAt,
  };
}

/**
 * Get ranking for single token
 */
export async function getTokenRanking(symbol: string) {
  const ranking = await TokenRankingModel.findOne({ 
    symbol: symbol.toUpperCase() 
  })
    .select('-_id')
    .lean();
  
  return ranking;
}

/**
 * Get top movers (highest momentum)
 */
export async function getTopMovers(limit = 10) {
  const movers = await TokenRankingModel.find({})
    .sort({ momentumScore: -1 })
    .limit(limit)
    .select('-_id symbol name priceChange24h momentumScore bucket')
    .lean();
  
  return movers;
}
