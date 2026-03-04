/**
 * TRUTH RESOLVER SERVICE
 * ======================
 * 
 * Answers the question: "What is the TRUE state of this asset?"
 * 
 * - Uses 1-2 best sources
 * - Ignores anomalous sources
 * - Provides confidence and quality metrics
 * 
 * @sealed v1.0
 */

import type {
  VenueId,
  VenueObservation,
  ResolvedAssetState,
  VenueMLFeatures,
} from '../contracts/assets.types.js';
import { getAsset, getActiveVenues, getAssetPair } from './assets.registry.js';
import { getBinanceTicker } from '../adapters/binance.adapter.js';
import { getBybitTicker } from '../adapters/bybit.adapter.js';
import { getCoinbaseTicker } from '../adapters/coinbase.adapter.js';

// ═══════════════════════════════════════════════════════════════
// VENUE PRIORITY
// ═══════════════════════════════════════════════════════════════

const VENUE_PRIORITY_ORDER: VenueId[] = ['BINANCE', 'BYBIT', 'COINBASE', 'HYPERLIQUID'];

// ═══════════════════════════════════════════════════════════════
// FETCH OBSERVATION FROM VENUE
// ═══════════════════════════════════════════════════════════════

async function fetchObservation(
  assetId: string,
  venue: VenueId
): Promise<VenueObservation | null> {
  const pair = getAssetPair(assetId, venue);
  if (!pair) return null;
  
  switch (venue) {
    case 'BINANCE':
      return getBinanceTicker(pair);
    case 'BYBIT':
      return getBybitTicker(pair);
    case 'COINBASE':
      return getCoinbaseTicker(pair);
    case 'HYPERLIQUID':
      // TODO: Implement Hyperliquid adapter
      return null;
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// RESOLVE ASSET STATE (TRUTH)
// ═══════════════════════════════════════════════════════════════

export async function resolveAssetState(assetId: string): Promise<ResolvedAssetState | null> {
  const asset = getAsset(assetId);
  if (!asset) {
    console.warn(`[TruthResolver] Unknown asset: ${assetId}`);
    return null;
  }
  
  const activeVenues = getActiveVenues(assetId);
  if (activeVenues.length === 0) {
    console.warn(`[TruthResolver] No active venues for: ${assetId}`);
    return null;
  }
  
  // Fetch observations from all active venues in parallel
  const observationPromises = activeVenues.map(v => fetchObservation(assetId, v));
  const observations = await Promise.all(observationPromises);
  
  // Filter out failed observations
  const validObservations: VenueObservation[] = [];
  for (let i = 0; i < observations.length; i++) {
    if (observations[i]) {
      validObservations.push(observations[i]!);
    }
  }
  
  if (validObservations.length === 0) {
    console.warn(`[TruthResolver] No valid observations for: ${assetId}`);
    return null;
  }
  
  // Sort by trust score (highest first)
  validObservations.sort((a, b) => b.trustScore - a.trustScore);
  
  // Determine which sources to use and which to ignore
  const sourcesUsed: VenueId[] = [];
  const sourcesIgnored: Array<{ venue: VenueId; reason: string }> = [];
  
  // Primary source = highest trust score
  const primary = validObservations[0];
  sourcesUsed.push(primary.venue);
  
  // Check for price agreement with other sources
  const priceAgreementThreshold = 0.5; // 0.5% max deviation
  
  for (let i = 1; i < validObservations.length; i++) {
    const obs = validObservations[i];
    const deviation = Math.abs(obs.price - primary.price) / primary.price * 100;
    
    if (deviation > priceAgreementThreshold) {
      // Price doesn't agree - check for anomalies
      if (obs.anomalies && obs.anomalies.length > 0) {
        sourcesIgnored.push({
          venue: obs.venue,
          reason: `Anomalies: ${obs.anomalies.join(', ')}`,
        });
      } else if (obs.trustScore < 0.7) {
        sourcesIgnored.push({
          venue: obs.venue,
          reason: `Low trust score (${obs.trustScore.toFixed(2)})`,
        });
      } else {
        sourcesIgnored.push({
          venue: obs.venue,
          reason: `Price deviation ${deviation.toFixed(2)}%`,
        });
      }
    } else {
      // Price agrees - use as confirmation
      sourcesUsed.push(obs.venue);
    }
  }
  
  // Calculate venue agreement score
  const venueAgreement = sourcesUsed.length / validObservations.length;
  
  // Calculate price dispersion
  const prices = validObservations.map(o => o.price);
  const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
  const priceDispersion = prices.reduce((sum, p) => sum + Math.abs(p - avgPrice), 0) / prices.length / avgPrice * 100;
  
  // Weighted average price from used sources
  const usedObservations = validObservations.filter(o => sourcesUsed.includes(o.venue));
  const totalWeight = usedObservations.reduce((sum, o) => sum + o.trustScore, 0);
  const resolvedPrice = usedObservations.reduce((sum, o) => sum + o.price * o.trustScore, 0) / totalWeight;
  
  // Calculate confidence
  let confidence = 0.5;
  if (venueAgreement >= 0.8) confidence += 0.3;
  else if (venueAgreement >= 0.5) confidence += 0.15;
  if (priceDispersion < 0.1) confidence += 0.15;
  if (primary.trustScore > 0.9) confidence += 0.1;
  confidence = Math.min(1, confidence);
  
  // Determine data quality
  let dataQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'DEGRADED';
  if (confidence >= 0.85 && sourcesUsed.length >= 2) {
    dataQuality = 'HIGH';
  } else if (confidence >= 0.65 && sourcesUsed.length >= 1) {
    dataQuality = 'MEDIUM';
  } else if (confidence >= 0.4) {
    dataQuality = 'LOW';
  } else {
    dataQuality = 'DEGRADED';
  }
  
  // Resolution note
  let resolutionNote = '';
  if (sourcesUsed.length >= 2 && venueAgreement >= 0.8) {
    resolutionNote = `${sourcesUsed.join(' & ')} aligned. High confidence.`;
  } else if (sourcesUsed.length === 1 && sourcesIgnored.length > 0) {
    resolutionNote = `Using ${sourcesUsed[0]} only. ${sourcesIgnored.length} source(s) ignored.`;
  } else if (sourcesUsed.length === 1) {
    resolutionNote = `Single source: ${sourcesUsed[0]}.`;
  } else {
    resolutionNote = 'Market fragmented across venues.';
  }
  
  return {
    asset: assetId,
    price: resolvedPrice,
    priceChange24h: 0, // TODO: Calculate from historical
    confidence,
    sourcesUsed,
    sourcesIgnored,
    venueAgreement,
    priceDispersion,
    dominantVenue: primary.venue,
    resolvedAt: Date.now(),
    dataQuality,
    resolutionNote,
  };
}

// ═══════════════════════════════════════════════════════════════
// GET ML FEATURES
// ═══════════════════════════════════════════════════════════════

export async function getVenueMLFeatures(assetId: string): Promise<VenueMLFeatures | null> {
  const state = await resolveAssetState(assetId);
  if (!state) return null;
  
  return {
    venueAgreementScore: state.venueAgreement,
    venueDispersion: state.priceDispersion,
    dominantVenue: state.dominantVenue,
    venueConfidence: state.confidence,
    venueSwitch: false, // TODO: Track historical dominant venue changes
    activeVenueCount: state.sourcesUsed.length + state.sourcesIgnored.length,
    avgLatencyMs: 0, // TODO: Calculate from observations
  };
}

// ═══════════════════════════════════════════════════════════════
// BATCH RESOLVE
// ═══════════════════════════════════════════════════════════════

export async function resolveMultipleAssets(
  assetIds: string[]
): Promise<Map<string, ResolvedAssetState>> {
  const results = new Map<string, ResolvedAssetState>();
  
  // Resolve in parallel
  const promises = assetIds.map(async (id) => {
    const state = await resolveAssetState(id);
    if (state) {
      results.set(id, state);
    }
  });
  
  await Promise.all(promises);
  return results;
}

console.log('[TruthResolver] Service loaded');
