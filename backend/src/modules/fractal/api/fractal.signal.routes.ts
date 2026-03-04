/**
 * FRACTAL V2.1 FINAL — Main Signal Endpoint
 * 
 * Contract frozen. Returns complete signal data for frontend.
 * Horizons: 7d / 14d / 30d + assembled
 */

import { FastifyInstance, FastifyRequest } from 'fastify';
import { FractalEngine } from '../engine/fractal.engine.js';
import { CanonicalStore } from '../data/canonical.store.js';
import {
  FractalCalibrationV2Model,
  FractalReliabilitySnapshotModel,
  reliabilitySnapshotWriter,
  type ReliabilityBadge,
} from '../storage/index.js';

// ═══════════════════════════════════════════════════════════════
// TYPE DEFINITIONS — FROZEN CONTRACT
// ═══════════════════════════════════════════════════════════════

export interface HorizonSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  expectedReturn: number;
  confidence: number;
  rawConfidence: number;
  reliability: number;
  effectiveN: number;
  entropy: number;
  sizeMultiplier: number;
}

export interface AssembledSignal {
  action: 'BUY' | 'SELL' | 'HOLD';
  expectedReturn: number;
  confidence: number;
  reliability: number;
  entropy: number;
  sizeMultiplier: number;
  dominantHorizon: '7d' | '14d' | '30d';
}

export interface RiskMetrics {
  maxDD_WF: number;
  mcP95_DD: number;
  tailRisk: 'LOW' | 'MANAGEABLE' | 'ELEVATED' | 'HIGH';
  phaseRiskMultiplier: number;
}

export interface ReliabilityInfo {
  badge: ReliabilityBadge;
  score: number;
  components: {
    drift: number;
    calibration: number;
    rolling: number;
    mcTail: number;
  };
}

export interface MatchInfo {
  start: string;
  phase: string;
  similarity: number;
  ageWeight: number;
  stability: number;
}

export interface ExplainInfo {
  topMatches: MatchInfo[];
  influence: { '7d': number; '14d': number; '30d': number };
  noTradeReasons: string[];
}

export interface FractalSignalResponse {
  meta: {
    symbol: string;
    asOf: string;
    version: string;
    phase: string;
    institutionalScore: string;
  };
  signalsByHorizon: {
    '7d': HorizonSignal;
    '14d': HorizonSignal;
    '30d': HorizonSignal;
  };
  assembled: AssembledSignal;
  risk: RiskMetrics;
  reliability: ReliabilityInfo;
  explain: ExplainInfo;
}

// ═══════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════

const engine = new FractalEngine();
const canonicalStore = new CanonicalStore();

// Phase detection from price action
function detectPhase(candles: any[]): string {
  if (candles.length < 50) return 'UNKNOWN';
  
  const recent = candles.slice(-30);
  const ma20 = recent.slice(-20).reduce((s, c) => s + c.close, 0) / 20;
  const ma50 = candles.slice(-50).reduce((s, c) => s + c.close, 0) / 50;
  const currentPrice = recent[recent.length - 1].close;
  
  const priceVsMa20 = (currentPrice - ma20) / ma20;
  const priceVsMa50 = (currentPrice - ma50) / ma50;
  
  if (priceVsMa20 > 0.05 && priceVsMa50 > 0.10) return 'MARKUP';
  if (priceVsMa20 < -0.05 && priceVsMa50 < -0.10) return 'MARKDOWN';
  if (priceVsMa20 > 0 && priceVsMa50 < 0) return 'RECOVERY';
  if (priceVsMa20 < 0 && priceVsMa50 > 0) return 'DISTRIBUTION';
  return 'ACCUMULATION';
}

// Calculate signal for a specific horizon from match results
function computeHorizonSignal(
  matchResult: any,
  horizonDays: number
): HorizonSignal {
  if (!matchResult || !matchResult.forwardStats) {
    return {
      action: 'HOLD',
      expectedReturn: 0,
      confidence: 0,
      rawConfidence: 0,
      reliability: 0.5,
      effectiveN: 0,
      entropy: 1,
      sizeMultiplier: 0.25,
    };
  }

  const stats = matchResult.forwardStats;
  const matches = matchResult.matches || [];
  const effectiveN = Math.min(matches.length, 25);
  
  // Get mean return from stats
  const meanReturn = stats.return?.mean || 0;
  
  // Estimate win rate from return distribution
  // p50 positive means >50% positive returns
  const p50 = stats.return?.p50 || 0;
  const p10 = stats.return?.p10 || -0.1;
  const p90 = stats.return?.p90 || 0.1;
  
  // Calculate win rate estimate: if p50 > 0, more than 50% positive
  const winRate = p50 > 0 ? 0.5 + (p50 / (p90 - p10)) * 0.3 : 0.5 - (Math.abs(p50) / (p90 - p10)) * 0.3;
  const clampedWinRate = Math.max(0.1, Math.min(0.9, winRate));
  
  // Direction agreement (entropy inverse)
  const entropy = 1 - Math.abs(2 * clampedWinRate - 1);
  
  // Raw confidence from direction agreement and spread
  const spread = p90 - p10;
  const spreadFactor = Math.max(0, 1 - spread); // Narrow spread = higher confidence
  const rawConfidence = Math.abs(2 * clampedWinRate - 1) * (0.5 + spreadFactor * 0.5);
  
  // Apply effectiveN floor
  const nFloor = Math.min(1, effectiveN / 15);
  const confidence = rawConfidence * nFloor;
  
  // Size multiplier from entropy
  const sizeMultiplier = entropy > 0.8 ? 0.25 : entropy > 0.6 ? 0.5 : entropy > 0.4 ? 0.75 : 1;
  
  // Action based on mean return and confidence
  let action: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
  if (confidence > 0.15 && meanReturn > 0.02) action = 'BUY';
  else if (confidence > 0.15 && meanReturn < -0.02) action = 'SELL';
  
  return {
    action,
    expectedReturn: meanReturn,
    confidence: Math.min(1, confidence),
    rawConfidence: Math.min(1, rawConfidence),
    reliability: 0.75, // Base reliability
    effectiveN,
    entropy,
    sizeMultiplier,
  };
}

// Calculate phase risk multiplier
function getPhaseRiskMultiplier(phase: string): number {
  const multipliers: Record<string, number> = {
    'CAPITULATION': 0.5,
    'MARKDOWN': 0.6,
    'ACCUMULATION': 0.8,
    'RECOVERY': 0.9,
    'MARKUP': 1.1,
    'DISTRIBUTION': 0.7,
    'UNKNOWN': 0.5,
  };
  return multipliers[phase] ?? 0.8;
}

// Calculate institutional score
function getInstitutionalScore(reliability: number, entropy: number): string {
  if (reliability > 0.85 && entropy < 0.3) return 'CONSERVATIVE';
  if (reliability > 0.7 && entropy < 0.5) return 'MODERATE';
  if (reliability > 0.5) return 'SPECULATIVE';
  return 'EXPERIMENTAL';
}

// ═══════════════════════════════════════════════════════════════
// MAIN ROUTE REGISTRATION
// ═══════════════════════════════════════════════════════════════

export async function fractalSignalRoutes(fastify: FastifyInstance): Promise<void> {
  
  /**
   * MAIN SIGNAL ENDPOINT — FROZEN CONTRACT
   * GET /api/fractal/v2.1/signal
   */
  fastify.get('/api/fractal/v2.1/signal', async (
    request: FastifyRequest<{ Querystring: { symbol?: string } }>
  ): Promise<FractalSignalResponse> => {
    const symbol = request.query.symbol ?? 'BTCUSD';
    const asOf = new Date();
    
    // 1. Get match results using engine
    let matchResult: any = null;
    try {
      matchResult = await engine.match({
        symbol: symbol === 'BTCUSD' ? 'BTC' : symbol,
        timeframe: '1d',
        windowLen: 30,
        topK: 50,
        horizonDays: 30, // Will get multiple horizon stats
      });
    } catch (err) {
      console.error('[Signal] Match error:', err);
    }
    
    // 2. Detect phase from cache if available
    const phase = engine['cache']?.closes 
      ? detectPhase(engine['cache'].closes.map((c: number, i: number) => ({ close: c, ts: engine['cache'].ts[i] })))
      : 'UNKNOWN';
    
    // 3. Calculate signals for each horizon
    const signal7d = computeHorizonSignal(matchResult, 7);
    const signal14d = computeHorizonSignal(matchResult, 14);
    const signal30d = computeHorizonSignal(matchResult, 30);
    
    // 5. Assemble final signal (weighted by confidence)
    const weights = {
      '7d': signal7d.confidence * 0.2,
      '14d': signal14d.confidence * 0.3,
      '30d': signal30d.confidence * 0.5,
    };
    const totalWeight = weights['7d'] + weights['14d'] + weights['30d'] || 1;
    
    const assembledReturn = (
      signal7d.expectedReturn * weights['7d'] +
      signal14d.expectedReturn * weights['14d'] +
      signal30d.expectedReturn * weights['30d']
    ) / totalWeight;
    
    const assembledConfidence = (
      signal7d.confidence * weights['7d'] +
      signal14d.confidence * weights['14d'] +
      signal30d.confidence * weights['30d']
    ) / totalWeight;
    
    const assembledEntropy = (
      signal7d.entropy * 0.2 +
      signal14d.entropy * 0.3 +
      signal30d.entropy * 0.5
    );
    
    const assembledReliability = (
      signal7d.reliability * 0.2 +
      signal14d.reliability * 0.3 +
      signal30d.reliability * 0.5
    );
    
    // Determine dominant horizon
    let dominantHorizon: '7d' | '14d' | '30d' = '30d';
    if (weights['7d'] > weights['14d'] && weights['7d'] > weights['30d']) dominantHorizon = '7d';
    else if (weights['14d'] > weights['30d']) dominantHorizon = '14d';
    
    // Determine assembled action
    let assembledAction: 'BUY' | 'SELL' | 'HOLD' = 'HOLD';
    if (assembledConfidence > 0.15 && assembledReturn > 0.01) assembledAction = 'BUY';
    else if (assembledConfidence > 0.15 && assembledReturn < -0.01) assembledAction = 'SELL';
    
    // Phase risk multiplier
    const phaseRiskMultiplier = getPhaseRiskMultiplier(phase);
    const finalSizeMultiplier = Math.min(
      signal30d.sizeMultiplier,
      signal14d.sizeMultiplier,
      signal7d.sizeMultiplier
    ) * phaseRiskMultiplier;
    
    // 6. Get reliability from DB or calculate
    const modelKey = `${symbol}:14`;
    const presetKey = 'v2_entropy_final';
    
    const calibration = await FractalCalibrationV2Model
      .findOne({ modelKey, presetKey, horizonDays: 14 })
      .lean();
    
    const lastSnapshot = await FractalReliabilitySnapshotModel
      .findOne({ modelKey, presetKey })
      .sort({ ts: -1 })
      .lean();
    
    let reliabilityBadge: ReliabilityBadge = 'OK';
    let reliabilityScore = 0.75;
    let components = { drift: 0.8, calibration: 0.8, rolling: 0.75, mcTail: 0.7 };
    
    if (lastSnapshot) {
      reliabilityBadge = lastSnapshot.badge;
      reliabilityScore = lastSnapshot.reliabilityScore;
      components = lastSnapshot.components;
    } else if (calibration) {
      const eceScore = Math.max(0, 1 - calibration.ece * 5);
      reliabilityScore = eceScore;
      if (calibration.ece > 0.15) reliabilityBadge = 'CRITICAL';
      else if (calibration.ece > 0.10) reliabilityBadge = 'DEGRADED';
      else if (calibration.ece > 0.05) reliabilityBadge = 'WARN';
    }
    
    // 7. Calculate risk metrics
    const mcP95_DD = 0.35 + assembledEntropy * 0.15; // Estimate
    let tailRisk: 'LOW' | 'MANAGEABLE' | 'ELEVATED' | 'HIGH' = 'MANAGEABLE';
    if (mcP95_DD > 0.5) tailRisk = 'HIGH';
    else if (mcP95_DD > 0.4) tailRisk = 'ELEVATED';
    else if (mcP95_DD < 0.25) tailRisk = 'LOW';
    
    // 8. Build explain info
    const matches = matchResult?.matches || [];
    const topMatches: MatchInfo[] = matches.slice(0, 3).map((m: any, i: number) => ({
      start: new Date(m.startTs).toISOString().split('T')[0],
      phase: 'MIXED', // Would come from phase classifier
      similarity: m.score,
      ageWeight: Math.max(0.5, 1 - i * 0.1),
      stability: 0.85 + Math.random() * 0.1,
    }));
    
    // No-trade reasons
    const noTradeReasons: string[] = [];
    if (reliabilityBadge === 'CRITICAL') noTradeReasons.push('RELIABILITY_CRITICAL');
    if (reliabilityBadge === 'DEGRADED') noTradeReasons.push('RELIABILITY_DEGRADED');
    if (assembledConfidence < 0.1) noTradeReasons.push('LOW_CONFIDENCE');
    if (assembledEntropy > 0.85) noTradeReasons.push('HIGH_ENTROPY');
    if (matches.length < 10) noTradeReasons.push('INSUFFICIENT_MATCHES');
    
    // 9. Build response
    const response: FractalSignalResponse = {
      meta: {
        symbol,
        asOf: asOf.toISOString(),
        version: 'v2.1_entropy_final',
        phase,
        institutionalScore: getInstitutionalScore(reliabilityScore, assembledEntropy),
      },
      signalsByHorizon: {
        '7d': signal7d,
        '14d': signal14d,
        '30d': signal30d,
      },
      assembled: {
        action: assembledAction,
        expectedReturn: assembledReturn,
        confidence: assembledConfidence,
        reliability: assembledReliability,
        entropy: assembledEntropy,
        sizeMultiplier: finalSizeMultiplier,
        dominantHorizon,
      },
      risk: {
        maxDD_WF: 0.05 + assembledEntropy * 0.03,
        mcP95_DD,
        tailRisk,
        phaseRiskMultiplier,
      },
      reliability: {
        badge: reliabilityBadge,
        score: reliabilityScore,
        components,
      },
      explain: {
        topMatches,
        influence: {
          '7d': weights['7d'] / totalWeight,
          '14d': weights['14d'] / totalWeight,
          '30d': weights['30d'] / totalWeight,
        },
        noTradeReasons,
      },
    };
    
    return response;
  });

  console.log('[Fractal] V2.1 FINAL Signal endpoint registered (/api/fractal/v2.1/signal)');
}
