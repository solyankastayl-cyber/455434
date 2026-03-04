/**
 * Live Drift Service
 * 
 * Orchestrates SIM vs LIVE comparison.
 * 
 * READS:
 * - LiveFactApproved (from LI-4)
 * - SIM aggregates (simulated or historical data)
 * 
 * WRITES:
 * - LiveDriftSummary
 * - LiveDriftCursor
 * 
 * NO imports from Ranking / Engine / ML.
 */
import { LiveFactApprovedModel } from '../../approval/models/live_fact_approved.model.js';
import { LiveDriftSummaryModel } from '../models/liveDriftSummary.model.js';
import { LiveDriftCursorModel } from '../models/liveDriftCursor.model.js';
import { calculateDrift, checkMLReadiness } from '../math/driftMath.js';
import type { DriftLevel, DriftMetrics } from '../drift.types.js';
import { CANARY_TOKENS, CHAIN_CONFIG } from '../../live_ingestion.types.js';
import { WINDOWS, type WindowSize } from '../../services/window_calculator.js';

// ==================== TYPES ====================

export interface DriftComputeResult {
  token: string;
  window: WindowSize;
  computed: number;
  skipped: number;
  durationMs: number;
}

export interface DriftStats {
  totalSummaries: number;
  byLevel: Record<DriftLevel, number>;
  avgComposite: number;
  maxComposite: number;
  lastComputedAt: Date | null;
  cursorStatus: Array<{
    token: string;
    window: WindowSize;
    lastWindowEnd: Date;
  }>;
}

// ==================== CURSOR MANAGEMENT ====================

async function getCursor(
  tokenAddress: string,
  window: WindowSize
): Promise<Date | null> {
  const cursor = await LiveDriftCursorModel.findOne({
    tokenAddress: tokenAddress.toLowerCase(),
    window,
  });
  
  return cursor?.lastComputedWindowEnd ?? null;
}

async function updateCursor(
  tokenAddress: string,
  window: WindowSize,
  lastWindowEnd: Date
): Promise<void> {
  await LiveDriftCursorModel.findOneAndUpdate(
    {
      tokenAddress: tokenAddress.toLowerCase(),
      window,
    },
    {
      $set: {
        lastComputedWindowEnd: lastWindowEnd,
        lastComputedAt: new Date(),
      },
    },
    { upsert: true }
  );
}

// ==================== SIM DATA GENERATION ====================

/**
 * Generate SIM metrics for a window
 * 
 * In production, this would come from the simulation layer.
 * For now, we generate reasonable "expected" values based on historical data.
 * 
 * SIM represents "what we expected to happen"
 * LIVE represents "what actually happened"
 */
async function getSimMetrics(
  tokenAddress: string,
  window: WindowSize,
  windowStart: Date
): Promise<DriftMetrics | null> {
  // Get historical average from approved facts for this token/window
  // This gives us a baseline "expectation"
  const windowMs = {
    '1h': 3600000,
    '6h': 21600000,
    '24h': 86400000,
  }[window];
  
  // Look at last 7 days of data for this window type
  const lookbackStart = new Date(windowStart.getTime() - 7 * 24 * 60 * 60 * 1000);
  
  const historicalFacts = await LiveFactApprovedModel.find({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    'approval.status': 'APPROVED',
    windowStart: { $gte: lookbackStart, $lt: windowStart },
  }).lean();
  
  if (historicalFacts.length === 0) {
    // No historical data - use neutral baseline
    return {
      volume: 0,
      netFlow: 0,
      actorCount: 0,
    };
  }
  
  // Calculate average metrics
  let totalVolume = 0;
  let totalNetFlow = 0;
  let totalActors = 0;
  
  for (const fact of historicalFacts) {
    // Convert BigInt string to number for averaging
    totalVolume += parseFloat(fact.metrics.volumeIn) / 1e18 || 0;
    totalNetFlow += parseFloat(fact.metrics.netFlow) / 1e18 || 0;
    totalActors += fact.metrics.uniqueSenders + fact.metrics.uniqueReceivers;
  }
  
  const count = historicalFacts.length;
  
  return {
    volume: totalVolume / count,
    netFlow: totalNetFlow / count,
    actorCount: totalActors / count,
  };
}

/**
 * Get LIVE metrics from approved facts
 */
async function getLiveMetrics(
  tokenAddress: string,
  window: WindowSize,
  windowStart: Date
): Promise<DriftMetrics | null> {
  const fact = await LiveFactApprovedModel.findOne({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    windowStart,
    'approval.status': 'APPROVED',
  }).lean();
  
  if (!fact) {
    return null;
  }
  
  // Convert to comparable metrics
  return {
    volume: parseFloat(fact.metrics.volumeIn) / 1e18 || 0,
    netFlow: parseFloat(fact.metrics.netFlow) / 1e18 || 0,
    actorCount: fact.metrics.uniqueSenders + fact.metrics.uniqueReceivers,
  };
}

// ==================== DRIFT COMPUTATION ====================

/**
 * Check if summary already exists
 */
async function isAlreadyComputed(
  tokenAddress: string,
  window: WindowSize,
  windowStart: Date
): Promise<boolean> {
  const existing = await LiveDriftSummaryModel.findOne({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    windowStart,
  });
  
  return !!existing;
}

/**
 * Compute drift for a single window
 */
async function computeSingleDrift(
  tokenAddress: string,
  tokenSymbol: string,
  window: WindowSize,
  windowStart: Date,
  windowEnd: Date
): Promise<{ computed: boolean; level?: DriftLevel }> {
  // Check idempotency
  if (await isAlreadyComputed(tokenAddress, window, windowStart)) {
    return { computed: false };
  }
  
  // Get SIM and LIVE metrics
  const [sim, live] = await Promise.all([
    getSimMetrics(tokenAddress, window, windowStart),
    getLiveMetrics(tokenAddress, window, windowStart),
  ]);
  
  // Need LIVE data to compute drift
  if (!live) {
    return { computed: false };
  }
  
  // Use neutral SIM if no historical data
  const simMetrics = sim || { volume: 0, netFlow: 0, actorCount: 0 };
  
  // Calculate drift
  const { drift, level } = calculateDrift(simMetrics, live);
  
  // Create summary
  await LiveDriftSummaryModel.create({
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    tokenSymbol,
    window,
    windowStart,
    windowEnd,
    sim: simMetrics,
    live,
    drift,
    level,
    computedAt: new Date(),
  });
  
  return { computed: true, level };
}

/**
 * Compute drift for a token/window
 */
export async function computeTokenDrift(
  tokenAddress: string,
  tokenSymbol: string,
  window: WindowSize
): Promise<DriftComputeResult> {
  const startTime = Date.now();
  
  // Get cursor
  const cursorDate = await getCursor(tokenAddress, window);
  
  // Find approved facts to process
  const query: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
    tokenAddress: tokenAddress.toLowerCase(),
    window,
    'approval.status': 'APPROVED',
  };
  
  if (cursorDate) {
    query.windowEnd = { $gt: cursorDate };
  }
  
  const facts = await LiveFactApprovedModel.find(query)
    .sort({ windowStart: 1 })
    .lean();
  
  if (facts.length === 0) {
    return {
      token: tokenSymbol,
      window,
      computed: 0,
      skipped: 0,
      durationMs: Date.now() - startTime,
    };
  }
  
  // Process each window
  let computed = 0;
  let skipped = 0;
  let lastWindowEnd = cursorDate;
  
  for (const fact of facts) {
    const result = await computeSingleDrift(
      tokenAddress,
      tokenSymbol,
      window,
      fact.windowStart,
      fact.windowEnd
    );
    
    if (result.computed) {
      computed++;
    } else {
      skipped++;
    }
    
    lastWindowEnd = fact.windowEnd;
  }
  
  // Update cursor
  if (lastWindowEnd) {
    await updateCursor(tokenAddress, window, lastWindowEnd);
  }
  
  return {
    token: tokenSymbol,
    window,
    computed,
    skipped,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Compute drift for all tokens and windows
 */
export async function computeAllDrift(): Promise<{
  results: DriftComputeResult[];
  totals: {
    computed: number;
    skipped: number;
  };
  durationMs: number;
}> {
  const startTime = Date.now();
  const results: DriftComputeResult[] = [];
  
  let totalComputed = 0;
  let totalSkipped = 0;
  
  // Sequential processing
  for (const token of CANARY_TOKENS) {
    for (const window of WINDOWS) {
      const result = await computeTokenDrift(token.address, token.symbol, window);
      results.push(result);
      totalComputed += result.computed;
      totalSkipped += result.skipped;
    }
  }
  
  return {
    results,
    totals: {
      computed: totalComputed,
      skipped: totalSkipped,
    },
    durationMs: Date.now() - startTime,
  };
}

// ==================== STATS ====================

/**
 * Get drift statistics
 */
export async function getDriftStats(): Promise<DriftStats> {
  const [
    totalSummaries,
    levelCounts,
    avgComposite,
    maxDrift,
    latestDrift,
    cursors,
  ] = await Promise.all([
    LiveDriftSummaryModel.countDocuments(),
    LiveDriftSummaryModel.aggregate([
      { $group: { _id: '$level', count: { $sum: 1 } } },
    ]),
    LiveDriftSummaryModel.aggregate([
      { $group: { _id: null, avg: { $avg: '$drift.composite' } } },
    ]),
    LiveDriftSummaryModel.findOne().sort({ 'drift.composite': -1 }).select('drift.composite').lean(),
    LiveDriftSummaryModel.findOne().sort({ computedAt: -1 }).lean(),
    LiveDriftCursorModel.find().lean(),
  ]);
  
  const byLevel: Record<DriftLevel, number> = {
    LOW: 0,
    MEDIUM: 0,
    HIGH: 0,
    CRITICAL: 0,
  };
  
  levelCounts.forEach(l => {
    if (l._id in byLevel) {
      byLevel[l._id as DriftLevel] = l.count;
    }
  });
  
  return {
    totalSummaries,
    byLevel,
    avgComposite: avgComposite[0]?.avg ?? 0,
    maxComposite: maxDrift?.drift?.composite ?? 0,
    lastComputedAt: latestDrift?.computedAt ?? null,
    cursorStatus: cursors.map(c => ({
      token: CANARY_TOKENS.find(t => 
        t.address.toLowerCase() === c.tokenAddress.toLowerCase()
      )?.symbol || c.tokenAddress.slice(0, 10),
      window: c.window as WindowSize,
      lastWindowEnd: c.lastComputedWindowEnd,
    })),
  };
}

// ==================== READ SUMMARIES ====================

/**
 * Get drift summaries
 */
export async function getDriftSummaries(params: {
  tokenAddress?: string;
  window?: WindowSize;
  level?: DriftLevel;
  limit?: number;
}): Promise<any[]> {
  const filter: any = {
    chainId: CHAIN_CONFIG.CHAIN_ID,
  };
  
  if (params.tokenAddress) {
    filter.tokenAddress = params.tokenAddress.toLowerCase();
  }
  
  if (params.window) {
    filter.window = params.window;
  }
  
  if (params.level) {
    filter.level = params.level;
  }
  
  const limit = Math.min(params.limit || 50, 100);
  
  const summaries = await LiveDriftSummaryModel.find(filter)
    .sort({ windowEnd: -1 })
    .limit(limit)
    .select('-__v')
    .lean();
  
  return summaries.map(s => ({
    ...s,
    _id: undefined,
  }));
}

/**
 * Get latest drift per token per window
 */
export async function getLatestDrift(): Promise<Array<{
  token: string;
  window: WindowSize;
  composite: number;
  level: DriftLevel;
  windowEnd: Date;
}>> {
  const results = [];
  
  for (const token of CANARY_TOKENS) {
    for (const window of WINDOWS) {
      const latest = await LiveDriftSummaryModel.findOne({
        chainId: CHAIN_CONFIG.CHAIN_ID,
        tokenAddress: token.address.toLowerCase(),
        window,
      })
        .sort({ windowEnd: -1 })
        .lean();
      
      if (latest) {
        results.push({
          token: token.symbol,
          window,
          composite: latest.drift.composite,
          level: latest.level,
          windowEnd: latest.windowEnd,
        });
      }
    }
  }
  
  return results;
}

/**
 * Get ML Ready status based on drift
 */
export async function getDriftMLReadyStatus(): Promise<{
  status: 'READY' | 'CONDITIONAL' | 'NOT_READY';
  reason: string;
  criticalCount: number;
  highCount: number;
  maxDrift24h: number;
  lowMediumPct: number;
}> {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const recentDrift = await LiveDriftSummaryModel.find({
    computedAt: { $gte: twentyFourHoursAgo },
  }).lean();
  
  if (recentDrift.length === 0) {
    return {
      status: 'NOT_READY',
      reason: 'No drift data available',
      criticalCount: 0,
      highCount: 0,
      maxDrift24h: 0,
      lowMediumPct: 0,
    };
  }
  
  const criticalCount = recentDrift.filter(d => d.level === 'CRITICAL').length;
  const highCount = recentDrift.filter(d => d.level === 'HIGH').length;
  const lowMediumCount = recentDrift.filter(d => d.level === 'LOW' || d.level === 'MEDIUM').length;
  const maxDrift = Math.max(...recentDrift.map(d => d.drift.composite));
  
  const total = recentDrift.length;
  const highPct = highCount / total;
  const lowMediumPct = lowMediumCount / total;
  
  // Determine status
  if (criticalCount >= 1) {
    return {
      status: 'NOT_READY',
      reason: `${criticalCount} CRITICAL drift detected - world diverges from model`,
      criticalCount,
      highCount,
      maxDrift24h: maxDrift,
      lowMediumPct,
    };
  }
  
  if (highPct > 0.3) {
    return {
      status: 'CONDITIONAL',
      reason: `HIGH drift in ${Math.round(highPct * 100)}% of windows - shadow mode only`,
      criticalCount,
      highCount,
      maxDrift24h: maxDrift,
      lowMediumPct,
    };
  }
  
  if (lowMediumPct >= 0.7) {
    return {
      status: 'READY',
      reason: `${Math.round(lowMediumPct * 100)}% windows have LOW/MEDIUM drift - model aligned with reality`,
      criticalCount,
      highCount,
      maxDrift24h: maxDrift,
      lowMediumPct,
    };
  }
  
  return {
    status: 'CONDITIONAL',
    reason: 'Drift levels mixed - proceed with caution',
    criticalCount,
    highCount,
    maxDrift24h: maxDrift,
    lowMediumPct,
  };
}
