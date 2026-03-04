/**
 * MARKET EXPECTATION TYPES
 * ========================
 * 
 * Decision intelligence, NOT price forecasting.
 * 
 * ML generates: direction + confidence + horizon
 * ML does NOT generate: price, target, prediction line
 * 
 * @sealed v1.0
 */

// ═══════════════════════════════════════════════════════════════
// EXPECTATION HORIZON
// ═══════════════════════════════════════════════════════════════

export type ExpectationHorizon = '1D' | '3D' | '7D';

export const HORIZON_MS: Record<ExpectationHorizon, number> = {
  '1D': 24 * 60 * 60 * 1000,
  '3D': 3 * 24 * 60 * 60 * 1000,
  '7D': 7 * 24 * 60 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// DIRECTION (NOT PRICE)
// ═══════════════════════════════════════════════════════════════

export type ExpectationDirection = 'UP' | 'DOWN' | 'FLAT';

// ═══════════════════════════════════════════════════════════════
// MAGNITUDE BUCKET (OPTIONAL)
// ═══════════════════════════════════════════════════════════════

export type MagnitudeBucket = 'SMALL' | 'MEDIUM' | 'LARGE';

export const MAGNITUDE_THRESHOLDS = {
  SMALL: { min: 0, max: 2 },      // 0-2%
  MEDIUM: { min: 2, max: 5 },     // 2-5%
  LARGE: { min: 5, max: Infinity }, // 5%+
};

// ═══════════════════════════════════════════════════════════════
// MARKET EXPECTATION
// ═══════════════════════════════════════════════════════════════

export interface MarketExpectation {
  /** Unique ID */
  id: string;
  
  /** Asset symbol (e.g., BTCUSDT) */
  asset: string;
  
  /** When expectation was issued */
  issuedAt: number;
  
  /** Time horizon for evaluation */
  horizon: ExpectationHorizon;
  
  /** Expected direction (NOT price) */
  direction: ExpectationDirection;
  
  /** Confidence in this expectation (0..1) */
  confidence: number;
  
  /** Expected magnitude bucket (optional) */
  expectedMagnitude?: MagnitudeBucket;
  
  /** Market regime at time of issuance */
  macroRegime: string;
  
  /** Risk level at time of issuance */
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  
  /** Hash of decision context (for audit) */
  decisionContextHash: string;
  
  /** Source verdict ID */
  verdictId?: string;
  
  /** Features used */
  features: {
    macro: boolean;
    onchain: boolean;
    sentiment: boolean;
    labs: string[];
  };
  
  /** Price at issuance (for outcome calculation only) */
  priceAtIssuance: number;
  
  /** Status */
  status: 'PENDING' | 'EVALUATED' | 'EXPIRED';
  
  /** Evaluation deadline */
  evaluateAt: number;
}

// ═══════════════════════════════════════════════════════════════
// CREATE EXPECTATION INPUT
// ═══════════════════════════════════════════════════════════════

export interface CreateExpectationInput {
  asset: string;
  direction: ExpectationDirection;
  confidence: number;
  horizon: ExpectationHorizon;
  expectedMagnitude?: MagnitudeBucket;
  macroRegime: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  decisionContextHash: string;
  verdictId?: string;
  features: {
    macro: boolean;
    onchain: boolean;
    sentiment: boolean;
    labs: string[];
  };
  priceAtIssuance: number;
}

// ═══════════════════════════════════════════════════════════════
// EXPECTATION FILTERS
// ═══════════════════════════════════════════════════════════════

export interface ExpectationFilters {
  asset?: string;
  horizon?: ExpectationHorizon;
  status?: 'PENDING' | 'EVALUATED' | 'EXPIRED';
  direction?: ExpectationDirection;
  macroRegime?: string;
  fromDate?: number;
  toDate?: number;
  minConfidence?: number;
  limit?: number;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION
// ═══════════════════════════════════════════════════════════════

export function validateExpectationInput(input: CreateExpectationInput): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  
  if (!input.asset) errors.push('Asset is required');
  if (!input.direction) errors.push('Direction is required');
  if (input.confidence < 0 || input.confidence > 1) {
    errors.push('Confidence must be between 0 and 1');
  }
  if (!['1D', '3D', '7D'].includes(input.horizon)) {
    errors.push('Invalid horizon');
  }
  if (input.priceAtIssuance <= 0) {
    errors.push('Price at issuance must be positive');
  }
  
  return { valid: errors.length === 0, errors };
}

console.log('[MarketExpectation] Types loaded');
