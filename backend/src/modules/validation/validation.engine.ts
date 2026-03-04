/**
 * C2.2 — Exchange × On-chain Validation Engine
 * =============================================
 * 
 * ROLE: Check if Exchange verdict is confirmed by on-chain reality.
 * 
 * NOT a prediction.
 * NOT a signal.
 * NOT a decision.
 * 
 * RESULT: CONFIRMS | CONTRADICTS | NO_DATA
 * 
 * INVARIANTS:
 * - Validation does NOT change verdict
 * - Validation does NOT upgrade confidence
 * - Validation does NOT know about Sentiment
 * - Validation does NOT participate in ML
 */

import {
  OnchainMetrics,
  OnchainObservation,
  OnchainState,
  deriveOnchainState,
  OnchainWindow,
  ONCHAIN_THRESHOLDS,
} from '../onchain/onchain.contracts.js';

// ═══════════════════════════════════════════════════════════════
// CONTRACTS (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

export type ExchangeVerdict = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type ValidationResultType = 'CONFIRMS' | 'CONTRADICTS' | 'NO_DATA';

/**
 * Exchange input for validation
 */
export interface ExchangeInput {
  verdict: ExchangeVerdict;
  confidence: number;
  drivers?: string[];
}

/**
 * On-chain input for validation
 */
export interface OnchainInput {
  state: OnchainState;
  confidence: number;
  metrics: OnchainMetrics;
}

/**
 * Validation result (immutable once created)
 */
export interface ValidationResult {
  symbol: string;
  t0: number;
  
  exchange: {
    verdict: ExchangeVerdict;
    confidence: number;
  };
  
  onchain: {
    state: OnchainState;
    confidence: number;
  };
  
  validation: {
    result: ValidationResultType;
    strength: number;        // [0..1]
    reason: string[];        // explainable drivers
  };
  
  integrity: {
    usable: boolean;
    reason?: string;
  };
  
  createdAt: number;
}

// ═══════════════════════════════════════════════════════════════
// VALIDATION LOGIC (LOCKED v1)
// ═══════════════════════════════════════════════════════════════

/**
 * Validation mapping table:
 * 
 * | Exchange Verdict | On-chain State  | Result       |
 * |------------------|-----------------|--------------|
 * | BULLISH          | ACCUMULATION    | CONFIRMS     |
 * | BEARISH          | DISTRIBUTION    | CONFIRMS     |
 * | BULLISH          | DISTRIBUTION    | CONTRADICTS  |
 * | BEARISH          | ACCUMULATION    | CONTRADICTS  |
 * | NEUTRAL          | ANY             | NO_DATA      |
 * | ANY              | NO_DATA         | NO_DATA      |
 * | ANY              | NEUTRAL         | NO_DATA      |
 */
const VALIDATION_MAP: Record<ExchangeVerdict, Record<OnchainState, ValidationResultType>> = {
  BULLISH: {
    ACCUMULATION: 'CONFIRMS',
    DISTRIBUTION: 'CONTRADICTS',
    NEUTRAL: 'NO_DATA',
    NO_DATA: 'NO_DATA',
  },
  BEARISH: {
    ACCUMULATION: 'CONTRADICTS',
    DISTRIBUTION: 'CONFIRMS',
    NEUTRAL: 'NO_DATA',
    NO_DATA: 'NO_DATA',
  },
  NEUTRAL: {
    ACCUMULATION: 'NO_DATA',
    DISTRIBUTION: 'NO_DATA',
    NEUTRAL: 'NO_DATA',
    NO_DATA: 'NO_DATA',
  },
};

/**
 * Alignment factor for strength calculation
 */
const ALIGNMENT_FACTORS: Record<ValidationResultType, number> = {
  CONFIRMS: 1.0,
  CONTRADICTS: 0.7,
  NO_DATA: 0.0,
};

// ═══════════════════════════════════════════════════════════════
// ENGINE
// ═══════════════════════════════════════════════════════════════

class ValidationEngine {
  /**
   * Validate Exchange verdict against On-chain observation
   */
  validate(
    symbol: string,
    t0: number,
    exchange: ExchangeInput,
    onchain: OnchainInput
  ): ValidationResult {
    // Guard: check minimum confidence thresholds
    const minConfidence = ONCHAIN_THRESHOLDS.MIN_USABLE_CONFIDENCE;
    
    if (exchange.confidence < minConfidence) {
      return this.buildResult(symbol, t0, exchange, onchain, 'NO_DATA', 0, 
        ['exchange_confidence_too_low'], false, 'Exchange confidence below threshold');
    }
    
    if (onchain.confidence < minConfidence) {
      return this.buildResult(symbol, t0, exchange, onchain, 'NO_DATA', 0,
        ['onchain_confidence_too_low'], false, 'On-chain confidence below threshold');
    }
    
    // Lookup validation result from mapping
    const result = VALIDATION_MAP[exchange.verdict][onchain.state];
    
    // Calculate strength
    const strength = this.calculateStrength(
      exchange.confidence,
      onchain.confidence,
      result
    );
    
    // Generate reasons
    const reasons = this.generateReasons(exchange, onchain, result);
    
    return this.buildResult(
      symbol, t0, exchange, onchain,
      result, strength, reasons,
      true, undefined
    );
  }
  
  /**
   * Validate using raw observation data
   */
  validateWithObservation(
    symbol: string,
    t0: number,
    exchangeVerdict: ExchangeVerdict,
    exchangeConfidence: number,
    observation: OnchainObservation
  ): ValidationResult {
    const onchainState = deriveOnchainState(observation.metrics);
    
    return this.validate(
      symbol,
      t0,
      { verdict: exchangeVerdict, confidence: exchangeConfidence },
      { 
        state: onchainState, 
        confidence: observation.metrics.confidence,
        metrics: observation.metrics,
      }
    );
  }
  
  /**
   * Calculate strength of validation
   * 
   * strength = min(exchange.confidence, onchain.confidence) × alignmentFactor
   */
  private calculateStrength(
    exchangeConfidence: number,
    onchainConfidence: number,
    result: ValidationResultType
  ): number {
    const minConfidence = Math.min(exchangeConfidence, onchainConfidence);
    const alignmentFactor = ALIGNMENT_FACTORS[result];
    
    return Math.round(minConfidence * alignmentFactor * 100) / 100;
  }
  
  /**
   * Generate explanation reasons
   */
  private generateReasons(
    exchange: ExchangeInput,
    onchain: OnchainInput,
    result: ValidationResultType
  ): string[] {
    const reasons: string[] = [];
    
    // Exchange reasons
    if (exchange.verdict === 'BULLISH') {
      reasons.push('exchange_bullish_structure');
    } else if (exchange.verdict === 'BEARISH') {
      reasons.push('exchange_bearish_structure');
    } else {
      reasons.push('exchange_neutral_structure');
    }
    
    // On-chain reasons
    if (onchain.state === 'ACCUMULATION') {
      reasons.push('onchain_accumulation_detected');
      if (onchain.metrics.flowScore < -0.3) {
        reasons.push('strong_net_inflows');
      }
      if (onchain.metrics.exchangePressure < -0.3) {
        reasons.push('exchange_withdrawals_elevated');
      }
    } else if (onchain.state === 'DISTRIBUTION') {
      reasons.push('onchain_distribution_detected');
      if (onchain.metrics.flowScore > 0.3) {
        reasons.push('strong_net_outflows');
      }
      if (onchain.metrics.exchangePressure > 0.3) {
        reasons.push('exchange_deposits_elevated');
      }
    } else if (onchain.state === 'NEUTRAL') {
      reasons.push('onchain_activity_neutral');
    } else {
      reasons.push('onchain_data_insufficient');
    }
    
    // Result-specific reasons
    if (result === 'CONFIRMS') {
      reasons.push('exchange_and_onchain_aligned');
    } else if (result === 'CONTRADICTS') {
      reasons.push('exchange_and_onchain_divergent');
    }
    
    // Whale activity
    if (onchain.metrics.whaleActivity > 0.6) {
      reasons.push('whale_activity_elevated');
    }
    
    return reasons.slice(0, 5);  // Max 5 reasons
  }
  
  /**
   * Build result object
   */
  private buildResult(
    symbol: string,
    t0: number,
    exchange: ExchangeInput,
    onchain: OnchainInput,
    result: ValidationResultType,
    strength: number,
    reasons: string[],
    usable: boolean,
    integrityReason?: string
  ): ValidationResult {
    return {
      symbol,
      t0,
      
      exchange: {
        verdict: exchange.verdict,
        confidence: exchange.confidence,
      },
      
      onchain: {
        state: onchain.state,
        confidence: onchain.confidence,
      },
      
      validation: {
        result,
        strength,
        reason: reasons,
      },
      
      integrity: {
        usable,
        reason: integrityReason,
      },
      
      createdAt: Date.now(),
    };
  }
}

export const validationEngine = new ValidationEngine();

console.log('[C2.2] ValidationEngine loaded');
