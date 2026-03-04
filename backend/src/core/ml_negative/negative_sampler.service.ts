/**
 * Negative Sample Sampler
 * 
 * EPIC 8: Selects candidates from Engine signals
 * 
 * Reads ONLY from:
 * - engine_signals
 * - temporal_features (EPIC 7)
 * 
 * Does NOT read:
 * - Tokens/Wallets directly
 * - UI state
 */

import type { NegativeCandidate } from './negative.types.js';

/**
 * Get candidates from engine signals
 * 
 * This is a placeholder that should be connected to actual signal collection
 */
export async function getCandidatesFromSignals(
  options: {
    horizon: string;
    maxCandidates: number;
    startDate?: Date;
    endDate?: Date;
  }
): Promise<NegativeCandidate[]> {
  const { maxCandidates, startDate, endDate } = options;
  
  // Calculate date range
  const end = endDate || new Date();
  const start = startDate || new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
  
  // TODO: Connect to actual engine_signals collection
  // For now, return empty array (no candidates until signals exist)
  
  console.log(`[NegativeSampler] Looking for candidates from ${start.toISOString()} to ${end.toISOString()}`);
  console.log(`[NegativeSampler] Max candidates: ${maxCandidates}`);
  
  // Placeholder: In production, this would query:
  // - accumulation signals
  // - smart money overlap signals
  // - flow spike signals
  // - etc.
  
  /*
  const signals = await EngineSignalModel.find({
    timestamp: { $gte: start, $lte: end },
    signalType: { $in: ['accumulation', 'smart_money', 'flow_spike'] },
  })
    .sort({ timestamp: -1 })
    .limit(maxCandidates)
    .lean();
  
  return signals.map(s => ({
    tokenAddress: s.tokenAddress,
    signalId: s._id.toString(),
    signalTimestamp: s.timestamp,
    signalType: s.signalType,
    signalStrength: s.strength || 0.5,
  }));
  */
  
  return [];
}

/**
 * Enrich candidate with temporal features
 */
export async function enrichWithTemporalFeatures(
  candidate: NegativeCandidate
): Promise<NegativeCandidate> {
  // TODO: Connect to shadow_features collection (EPIC 7)
  
  /*
  const features = await ShadowFeatureModel.findOne({
    tokenAddress: candidate.tokenAddress,
    createdAt: { $lte: candidate.signalTimestamp }
  })
    .sort({ createdAt: -1 })
    .lean();
  
  if (features?.featureVector) {
    candidate.temporalFeatures = features.featureVector;
  }
  */
  
  // Default temporal features if not found
  candidate.temporalFeatures = candidate.temporalFeatures || {
    net_flow_24h_delta: 0,
    net_flow_3d_delta: 0,
    net_flow_7d_delta: 0,
    net_flow_7d_slope: 0,
    net_flow_7d_acceleration: 0,
    net_flow_7d_consistency: 0.5,
    net_flow_7d_regime: 'NOISE',
  };
  
  return candidate;
}

/**
 * Enrich candidate with price data
 */
export async function enrichWithPriceData(
  candidate: NegativeCandidate,
  horizon: '7d' | '14d'
): Promise<NegativeCandidate> {
  // TODO: Connect to price data source
  
  /*
  const priceAtSignal = await getPriceAtTime(candidate.tokenAddress, candidate.signalTimestamp);
  const price24h = await getPriceAtTime(candidate.tokenAddress, addHours(candidate.signalTimestamp, 24));
  const price7d = await getPriceAtTime(candidate.tokenAddress, addDays(candidate.signalTimestamp, 7));
  
  // Get min/max in window
  const priceHistory = await getPriceHistory(
    candidate.tokenAddress,
    candidate.signalTimestamp,
    addDays(candidate.signalTimestamp, horizon === '7d' ? 7 : 14)
  );
  
  candidate.priceData = {
    priceAtSignal,
    price24h,
    price7d,
    maxPrice: Math.max(...priceHistory.map(p => p.price)),
    minPrice: Math.min(...priceHistory.map(p => p.price)),
  };
  */
  
  // Placeholder: no price data available yet
  candidate.priceData = undefined;
  
  return candidate;
}

/**
 * Filter candidates with insufficient data
 */
export function filterInsufficientCandidates(
  candidates: NegativeCandidate[]
): {
  valid: NegativeCandidate[];
  insufficient: NegativeCandidate[];
} {
  const valid: NegativeCandidate[] = [];
  const insufficient: NegativeCandidate[] = [];
  
  for (const c of candidates) {
    // Check required data
    const hasPrice = c.priceData !== undefined;
    const hasTemporal = c.temporalFeatures !== undefined;
    
    if (hasPrice && hasTemporal) {
      valid.push(c);
    } else {
      insufficient.push(c);
    }
  }
  
  return { valid, insufficient };
}

/**
 * Full sampling pipeline
 */
export async function sampleCandidates(
  options: {
    horizon: '7d' | '14d';
    maxCandidates: number;
  }
): Promise<{
  candidates: NegativeCandidate[];
  insufficientCount: number;
}> {
  // 1. Get raw candidates from signals
  const rawCandidates = await getCandidatesFromSignals({
    horizon: options.horizon,
    maxCandidates: options.maxCandidates * 2, // Get more to account for filtering
  });
  
  // 2. Enrich with temporal features
  const enrichedTemporal = await Promise.all(
    rawCandidates.map(c => enrichWithTemporalFeatures(c))
  );
  
  // 3. Enrich with price data
  const enrichedPrice = await Promise.all(
    enrichedTemporal.map(c => enrichWithPriceData(c, options.horizon))
  );
  
  // 4. Filter insufficient
  const { valid, insufficient } = filterInsufficientCandidates(enrichedPrice);
  
  // 5. Limit to requested count
  const limited = valid.slice(0, options.maxCandidates);
  
  return {
    candidates: limited,
    insufficientCount: insufficient.length,
  };
}
