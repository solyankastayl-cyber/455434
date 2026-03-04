/**
 * EXPECTATION BUILDER SERVICE
 * ===========================
 * 
 * Creates expectations from Meta-Brain verdicts.
 * Only emits when confidence >= threshold.
 */

import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import type {
  MarketExpectation,
  CreateExpectationInput,
  ExpectationDirection,
  ExpectationHorizon,
  MagnitudeBucket,
  HORIZON_MS,
} from '../contracts/expectation.types.js';

// ═══════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  /** Minimum confidence to emit expectation */
  minConfidence: 0.5,
  
  /** Default horizon */
  defaultHorizon: '1D' as ExpectationHorizon,
  
  /** Confidence thresholds for horizons */
  horizonThresholds: {
    '1D': 0.5,
    '3D': 0.6,
    '7D': 0.7,
  },
};

// ═══════════════════════════════════════════════════════════════
// BUILDER
// ═══════════════════════════════════════════════════════════════

export interface VerdictForExpectation {
  verdictId?: string;
  symbol: string;
  direction: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  confidence: number;
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  macroRegime: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  features: {
    macro: boolean;
    onchain: boolean;
    sentiment: boolean;
    labs: string[];
  };
  currentPrice: number;
}

/**
 * Build expectation from verdict
 * Returns null if confidence too low
 */
export function buildExpectationFromVerdict(
  verdict: VerdictForExpectation
): MarketExpectation | null {
  // Check minimum confidence
  if (verdict.confidence < CONFIG.minConfidence) {
    console.log(`[ExpectationBuilder] Skipping: confidence ${verdict.confidence} < ${CONFIG.minConfidence}`);
    return null;
  }
  
  // Map verdict direction to expectation direction
  const direction = mapDirection(verdict.direction);
  
  // Determine horizon based on confidence
  const horizon = determineHorizon(verdict.confidence);
  
  // Determine expected magnitude based on strength
  const expectedMagnitude = mapStrengthToMagnitude(verdict.strength);
  
  // Create context hash for audit
  const contextHash = createContextHash(verdict);
  
  const now = Date.now();
  const horizonMs = {
    '1D': 24 * 60 * 60 * 1000,
    '3D': 3 * 24 * 60 * 60 * 1000,
    '7D': 7 * 24 * 60 * 60 * 1000,
  };
  
  const expectation: MarketExpectation = {
    id: uuidv4(),
    asset: verdict.symbol,
    issuedAt: now,
    horizon,
    direction,
    confidence: verdict.confidence,
    expectedMagnitude,
    macroRegime: verdict.macroRegime,
    riskLevel: verdict.riskLevel,
    decisionContextHash: contextHash,
    verdictId: verdict.verdictId,
    features: verdict.features,
    priceAtIssuance: verdict.currentPrice,
    status: 'PENDING',
    evaluateAt: now + horizonMs[horizon],
  };
  
  console.log(`[ExpectationBuilder] Created: ${direction} ${horizon} @ ${verdict.confidence.toFixed(2)} confidence`);
  
  return expectation;
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function mapDirection(verdictDirection: 'BULLISH' | 'BEARISH' | 'NEUTRAL'): ExpectationDirection {
  switch (verdictDirection) {
    case 'BULLISH': return 'UP';
    case 'BEARISH': return 'DOWN';
    case 'NEUTRAL': return 'FLAT';
  }
}

function determineHorizon(confidence: number): ExpectationHorizon {
  // Higher confidence = longer horizon allowed
  if (confidence >= CONFIG.horizonThresholds['7D']) {
    return '7D';
  }
  if (confidence >= CONFIG.horizonThresholds['3D']) {
    return '3D';
  }
  return '1D';
}

function mapStrengthToMagnitude(strength: 'STRONG' | 'MODERATE' | 'WEAK'): MagnitudeBucket {
  switch (strength) {
    case 'STRONG': return 'LARGE';
    case 'MODERATE': return 'MEDIUM';
    case 'WEAK': return 'SMALL';
  }
}

function createContextHash(verdict: VerdictForExpectation): string {
  const data = JSON.stringify({
    symbol: verdict.symbol,
    direction: verdict.direction,
    confidence: verdict.confidence,
    macroRegime: verdict.macroRegime,
    riskLevel: verdict.riskLevel,
    timestamp: Date.now(),
  });
  
  return createHash('sha256').update(data).digest('hex').substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════
// BULK BUILDER
// ═══════════════════════════════════════════════════════════════

export function buildExpectationsForMultipleHorizons(
  verdict: VerdictForExpectation
): MarketExpectation[] {
  const expectations: MarketExpectation[] = [];
  const horizons: ExpectationHorizon[] = ['1D', '3D', '7D'];
  
  for (const horizon of horizons) {
    const threshold = CONFIG.horizonThresholds[horizon];
    if (verdict.confidence >= threshold) {
      const exp = buildExpectationFromVerdict(verdict);
      if (exp) {
        exp.horizon = horizon;
        exp.id = uuidv4(); // New ID for each horizon
        const horizonMs = {
          '1D': 24 * 60 * 60 * 1000,
          '3D': 3 * 24 * 60 * 60 * 1000,
          '7D': 7 * 24 * 60 * 60 * 1000,
        };
        exp.evaluateAt = Date.now() + horizonMs[horizon];
        expectations.push(exp);
      }
    }
  }
  
  return expectations;
}

console.log('[MarketExpectation] Builder service loaded');
