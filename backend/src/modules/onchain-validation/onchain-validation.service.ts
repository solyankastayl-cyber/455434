/**
 * S7.2 + S7.3 + S7.5 — Onchain Validation Service
 * ================================================
 * 
 * Core validation logic for S7.
 * Compares ObservationModel decisions with on-chain reality.
 * 
 * ============================================================
 * GOLDEN RULE (S7.5):
 * Onchain CANNOT improve signal.
 * Onchain can ONLY downgrade confidence or raise alert flags.
 * ============================================================
 * 
 * FORBIDDEN ACTIONS (will break architecture):
 * - ❌ Change label
 * - ❌ Upgrade USE → STRONG_USE
 * - ❌ Increase confidence
 * - ❌ Use ML
 * - ❌ Access future data
 * 
 * ALLOWED ACTIONS:
 * - ✅ DOWNGRADE confidence
 * - ✅ ADD alert flag
 * - ✅ MARK CONTRADICTS/CONFIRMS/NO_DATA
 * - ✅ ADD explanation
 */

import { IOnchainSnapshot } from './onchain-snapshot.model.js';
import { ObservationRow } from '../observation/observation.service.js';

// ============================================================
// Types
// ============================================================

export type ValidationVerdict = 'CONFIRMS' | 'CONTRADICTS' | 'NO_DATA';

export type ValidationImpact = 'NONE' | 'DOWNGRADE' | 'STRONG_ALERT';

export interface ValidationResult {
  verdict: ValidationVerdict;
  impact: ValidationImpact;
  confidence_delta: 0 | -0.1 | -0.2 | -0.3;
  flags: string[];
  explanation: string;
  rules_triggered: string[];
}

export interface ValidationOutput {
  observation_id: string;
  signal_id: string;
  
  // Original decision
  original_decision: 'USE' | 'IGNORE' | 'MISS_ALERT';
  original_confidence?: number;
  
  // Validation result
  validation: ValidationResult;
  
  // Final adjusted values
  validated_confidence?: number;
  
  // Metadata
  onchain_source: string;
  onchain_confidence: number;
  validated_at: Date;
}

// ============================================================
// Thresholds (FROZEN — do not change without version bump)
// ============================================================

const THRESHOLDS = {
  // Exchange flow
  STRONG_INFLOW: 0.3,      // pressure > 0.3 = significant sell pressure
  MODERATE_INFLOW: 0.15,   // pressure > 0.15 = moderate sell pressure
  
  // Whale activity
  WHALE_SIGNIFICANT: 5,    // 5+ whale txs = significant
  WHALE_EXTREME: 10,       // 10+ whale txs = extreme
  
  // Confidence for NO_DATA
  MIN_CONFIDENCE: 0.4,
};

// ============================================================
// Validation Rules (S7.3)
// Deterministic, no ML
// ============================================================

const VALIDATION_RULES = {
  /**
   * Rule 1: Exchange Inflow CONTRADICTS USE
   * If USE decision + high exchange inflow → market preparing to sell
   */
  EXCHANGE_INFLOW_CONTRADICTS: (
    observation: ObservationRow,
    snapshot: IOnchainSnapshot
  ): Partial<ValidationResult> | null => {
    if (observation.decision?.verdict !== 'USE') return null;
    if (snapshot.exchange_pressure <= THRESHOLDS.STRONG_INFLOW) return null;
    
    const isStrong = snapshot.exchange_pressure > 0.5;
    
    return {
      verdict: 'CONTRADICTS',
      impact: isStrong ? 'STRONG_ALERT' : 'DOWNGRADE',
      confidence_delta: isStrong ? -0.3 : -0.2,
      flags: ['exchange_inflow'],
      explanation: `Exchange inflow high (pressure=${snapshot.exchange_pressure.toFixed(2)}). Market preparing to sell.`,
      rules_triggered: ['EXCHANGE_INFLOW_CONTRADICTS'],
    };
  },
  
  /**
   * Rule 2: Whale Exit STRONG_ALERT
   * If USE decision + whale activity + outflow → whales exiting
   */
  WHALE_EXIT_ALERT: (
    observation: ObservationRow,
    snapshot: IOnchainSnapshot
  ): Partial<ValidationResult> | null => {
    if (observation.decision?.verdict !== 'USE') return null;
    if (!snapshot.whale_activity_flag) return null;
    if (snapshot.exchange_pressure <= 0) return null; // Not selling pressure
    
    return {
      verdict: 'CONTRADICTS',
      impact: 'STRONG_ALERT',
      confidence_delta: -0.3,
      flags: ['whale_exit', 'exchange_inflow'],
      explanation: `Whale activity (${snapshot.whale_tx_count} txs) with exchange inflow. Whales may be exiting.`,
      rules_triggered: ['WHALE_EXIT_ALERT'],
    };
  },
  
  /**
   * Rule 3: Net Outflow CONFIRMS USE
   * If USE decision + net outflow → accumulation, confirms bullish
   */
  NET_OUTFLOW_CONFIRMS: (
    observation: ObservationRow,
    snapshot: IOnchainSnapshot
  ): Partial<ValidationResult> | null => {
    if (observation.decision?.verdict !== 'USE') return null;
    if (snapshot.exchange_pressure >= 0) return null; // Not buy pressure
    
    // CONFIRMS does NOT increase confidence (golden rule)
    return {
      verdict: 'CONFIRMS',
      impact: 'NONE',
      confidence_delta: 0,
      flags: ['net_outflow'],
      explanation: `Exchange outflow (pressure=${snapshot.exchange_pressure.toFixed(2)}). Accumulation pattern supports signal.`,
      rules_triggered: ['NET_OUTFLOW_CONFIRMS'],
    };
  },
  
  /**
   * Rule 4: MISS_ALERT Confirmation
   * If MISS_ALERT + strong on-chain signal → system was truly blind
   */
  MISS_ALERT_CONFIRMED: (
    observation: ObservationRow,
    snapshot: IOnchainSnapshot
  ): Partial<ValidationResult> | null => {
    if (observation.decision?.verdict !== 'MISS_ALERT') return null;
    
    // Check if on-chain shows strong directional signal
    const strongSignal = snapshot.exchange_signal === 'STRONG_BUY' || 
                         snapshot.exchange_signal === 'STRONG_SELL';
    
    if (!strongSignal) return null;
    
    return {
      verdict: 'CONFIRMS',
      impact: 'STRONG_ALERT',
      confidence_delta: 0,
      flags: ['miss_confirmed', `onchain_${snapshot.exchange_signal.toLowerCase()}`],
      explanation: `On-chain shows ${snapshot.exchange_signal}. System correctly identified blind spot.`,
      rules_triggered: ['MISS_ALERT_CONFIRMED'],
    };
  },
  
  /**
   * Rule 5: IGNORE Validation
   * If IGNORE + strong on-chain signal → maybe missed something
   */
  IGNORE_RECHECK: (
    observation: ObservationRow,
    snapshot: IOnchainSnapshot
  ): Partial<ValidationResult> | null => {
    if (observation.decision?.verdict !== 'IGNORE') return null;
    
    const strongSignal = snapshot.exchange_signal === 'STRONG_BUY' || 
                         snapshot.exchange_signal === 'STRONG_SELL';
    
    if (strongSignal && snapshot.whale_activity_flag) {
      return {
        verdict: 'CONTRADICTS',
        impact: 'DOWNGRADE',
        confidence_delta: -0.1,
        flags: ['ignore_recheck'],
        explanation: `IGNORE signal but on-chain shows ${snapshot.exchange_signal} with whale activity. Worth reviewing.`,
        rules_triggered: ['IGNORE_RECHECK'],
      };
    }
    
    // IGNORE is fine, on-chain agrees
    return {
      verdict: 'CONFIRMS',
      impact: 'NONE',
      confidence_delta: 0,
      flags: [],
      explanation: 'On-chain data supports IGNORE decision.',
      rules_triggered: ['IGNORE_CONFIRMS'],
    };
  },
};

// ============================================================
// Validation Service
// ============================================================

class OnchainValidationService {
  
  /**
   * Validate an observation against on-chain snapshot
   * CORE S7 FUNCTION
   */
  validateWithOnchain(
    observation: ObservationRow,
    snapshot: IOnchainSnapshot | null
  ): ValidationResult {
    // Rule 0: NO_DATA if snapshot missing or low confidence
    if (!snapshot || snapshot.confidence < THRESHOLDS.MIN_CONFIDENCE) {
      return {
        verdict: 'NO_DATA',
        impact: 'NONE',
        confidence_delta: 0,
        flags: ['no_onchain_data'],
        explanation: snapshot 
          ? `On-chain confidence too low (${snapshot.confidence.toFixed(2)})`
          : 'No on-chain snapshot available',
        rules_triggered: ['NO_DATA_RULE'],
      };
    }
    
    // Apply rules in priority order
    const rules = [
      VALIDATION_RULES.WHALE_EXIT_ALERT,      // Highest priority - danger signal
      VALIDATION_RULES.EXCHANGE_INFLOW_CONTRADICTS,
      VALIDATION_RULES.MISS_ALERT_CONFIRMED,
      VALIDATION_RULES.IGNORE_RECHECK,
      VALIDATION_RULES.NET_OUTFLOW_CONFIRMS,  // Lowest priority - positive confirmation
    ];
    
    // Collect all triggered rules
    const triggeredResults: Partial<ValidationResult>[] = [];
    const allFlags: string[] = [];
    const allRules: string[] = [];
    
    for (const rule of rules) {
      const result = rule(observation, snapshot);
      if (result) {
        triggeredResults.push(result);
        if (result.flags) allFlags.push(...result.flags);
        if (result.rules_triggered) allRules.push(...result.rules_triggered);
      }
    }
    
    // No rules triggered = neutral
    if (triggeredResults.length === 0) {
      return {
        verdict: 'CONFIRMS',
        impact: 'NONE',
        confidence_delta: 0,
        flags: ['no_contradiction'],
        explanation: 'On-chain data neutral, no contradictions found.',
        rules_triggered: ['DEFAULT_NEUTRAL'],
      };
    }
    
    // Use most severe result
    // Priority: STRONG_ALERT > DOWNGRADE > NONE
    // Verdict: CONTRADICTS > CONFIRMS > NO_DATA
    
    let finalResult: ValidationResult = {
      verdict: 'CONFIRMS',
      impact: 'NONE',
      confidence_delta: 0,
      flags: [],
      explanation: '',
      rules_triggered: [],
    };
    
    for (const result of triggeredResults) {
      // Update verdict (CONTRADICTS is most severe)
      if (result.verdict === 'CONTRADICTS') {
        finalResult.verdict = 'CONTRADICTS';
      }
      
      // Update impact (STRONG_ALERT > DOWNGRADE > NONE)
      if (result.impact === 'STRONG_ALERT') {
        finalResult.impact = 'STRONG_ALERT';
      } else if (result.impact === 'DOWNGRADE' && finalResult.impact !== 'STRONG_ALERT') {
        finalResult.impact = 'DOWNGRADE';
      }
      
      // Use most severe confidence delta
      if ((result.confidence_delta || 0) < finalResult.confidence_delta) {
        finalResult.confidence_delta = result.confidence_delta as 0 | -0.1 | -0.2 | -0.3;
      }
      
      // Use first non-empty explanation
      if (!finalResult.explanation && result.explanation) {
        finalResult.explanation = result.explanation;
      }
    }
    
    // Combine all flags and rules
    finalResult.flags = [...new Set(allFlags)];
    finalResult.rules_triggered = [...new Set(allRules)];
    
    return finalResult;
  }
  
  /**
   * Create full validation output
   */
  createValidationOutput(
    observation: ObservationRow,
    snapshot: IOnchainSnapshot | null,
    validation: ValidationResult
  ): ValidationOutput {
    const originalConfidence = observation.sentiment?.confidence || 0.5;
    const validatedConfidence = Math.max(0, originalConfidence + validation.confidence_delta);
    
    return {
      observation_id: observation.observation_id,
      signal_id: observation.signal_id,
      
      original_decision: observation.decision?.verdict as 'USE' | 'IGNORE' | 'MISS_ALERT',
      original_confidence: originalConfidence,
      
      validation,
      
      validated_confidence: Math.round(validatedConfidence * 100) / 100,
      
      onchain_source: snapshot?.source || 'none',
      onchain_confidence: snapshot?.confidence || 0,
      validated_at: new Date(),
    };
  }
  
  /**
   * Get validation summary statistics
   */
  getValidationStats(outputs: ValidationOutput[]): {
    total: number;
    by_verdict: Record<ValidationVerdict, number>;
    by_impact: Record<ValidationImpact, number>;
    use_confirm_rate: number;
    use_contradict_rate: number;
    miss_confirm_rate: number;
    avg_confidence_delta: number;
  } {
    const total = outputs.length;
    
    const by_verdict: Record<ValidationVerdict, number> = {
      CONFIRMS: 0,
      CONTRADICTS: 0,
      NO_DATA: 0,
    };
    
    const by_impact: Record<ValidationImpact, number> = {
      NONE: 0,
      DOWNGRADE: 0,
      STRONG_ALERT: 0,
    };
    
    let useConfirms = 0;
    let useContradicts = 0;
    let useTotal = 0;
    let missConfirms = 0;
    let missTotal = 0;
    let totalDelta = 0;
    
    for (const output of outputs) {
      by_verdict[output.validation.verdict]++;
      by_impact[output.validation.impact]++;
      totalDelta += output.validation.confidence_delta;
      
      if (output.original_decision === 'USE') {
        useTotal++;
        if (output.validation.verdict === 'CONFIRMS') useConfirms++;
        if (output.validation.verdict === 'CONTRADICTS') useContradicts++;
      }
      
      if (output.original_decision === 'MISS_ALERT') {
        missTotal++;
        if (output.validation.verdict === 'CONFIRMS') missConfirms++;
      }
    }
    
    return {
      total,
      by_verdict,
      by_impact,
      use_confirm_rate: useTotal > 0 ? Math.round((useConfirms / useTotal) * 100) : 0,
      use_contradict_rate: useTotal > 0 ? Math.round((useContradicts / useTotal) * 100) : 0,
      miss_confirm_rate: missTotal > 0 ? Math.round((missConfirms / missTotal) * 100) : 0,
      avg_confidence_delta: total > 0 ? Math.round((totalDelta / total) * 100) / 100 : 0,
    };
  }
}

export const onchainValidationService = new OnchainValidationService();
