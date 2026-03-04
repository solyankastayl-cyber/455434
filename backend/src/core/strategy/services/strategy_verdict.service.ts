/**
 * S1.3 - Strategy Verdict Service
 * 
 * Combines backtest + stability + quality + guardrails
 * into a single final verdict.
 */
import type {
  VerdictInput,
  VerdictResult,
  StrategyFinalVerdict,
} from '../types/strategy_verdict.types.js';
import { getStrategyById } from '../types/strategy.catalog.js';

export class StrategyVerdictService {
  /**
   * Evaluate final verdict for a strategy
   */
  evaluate(input: VerdictInput): VerdictResult {
    const strategy = getStrategyById(input.strategyId);
    const strategyName = strategy?.name || input.strategyId;
    
    const { verdict, reasons } = this.deriveVerdict(input);
    const uiConfig = this.getUiConfig(verdict);

    return {
      strategyId: input.strategyId,
      strategyName,
      network: input.network,
      verdict,
      reasons,
      factors: {
        backtestVerdict: input.backtestVerdict,
        stabilityVerdict: input.stabilityVerdict,
        signalQuality: input.signalQuality,
        guardrailBlocked: input.guardrailBlocked,
      },
      uiConfig,
      createdAt: new Date(),
    };
  }

  /**
   * Core verdict logic
   */
  private deriveVerdict(input: VerdictInput): { verdict: StrategyFinalVerdict; reasons: string[] } {
    const reasons: string[] = [];

    // ❌ Hard blocks - DISABLED
    if (input.guardrailBlocked) {
      reasons.push('Blocked by guardrails');
      if (input.guardrailReasons) {
        reasons.push(...input.guardrailReasons);
      }
      return { verdict: 'DISABLED', reasons };
    }

    if (input.signalQuality === 'LOW') {
      reasons.push('Signal quality too low');
      return { verdict: 'DISABLED', reasons };
    }

    // ❌ Bad backtest - REJECTED
    if (input.backtestVerdict === 'BAD') {
      reasons.push('Negative backtest results');
      return { verdict: 'REJECTED', reasons };
    }

    // ⚠️ Mixed or unstable - EXPERIMENT_ONLY
    if (input.backtestVerdict === 'MIXED') {
      reasons.push('Mixed backtest results');
      return { verdict: 'EXPERIMENT_ONLY', reasons };
    }

    if (input.stabilityVerdict === 'UNSTABLE') {
      reasons.push('Model stability issues');
      return { verdict: 'EXPERIMENT_ONLY', reasons };
    }

    if (input.backtestVerdict === 'INSUFFICIENT_DATA') {
      reasons.push('Insufficient historical data');
      return { verdict: 'EXPERIMENT_ONLY', reasons };
    }

    // ✅ Production ready - all conditions met
    if (
      input.backtestVerdict === 'GOOD' &&
      (input.stabilityVerdict === 'STABLE' || !input.stabilityVerdict) &&
      (input.signalQuality === 'HIGH' || input.signalQuality === 'MEDIUM')
    ) {
      reasons.push('Consistent backtest edge');
      if (input.stabilityVerdict === 'STABLE') {
        reasons.push('Stable model performance');
      }
      if (input.signalQuality === 'HIGH') {
        reasons.push('High signal quality');
      }
      return { verdict: 'PRODUCTION_READY', reasons };
    }

    // Fallback - EXPERIMENT_ONLY
    reasons.push('Insufficient confidence for production');
    return { verdict: 'EXPERIMENT_ONLY', reasons };
  }

  /**
   * Get UI configuration for verdict
   */
  private getUiConfig(verdict: StrategyFinalVerdict): VerdictResult['uiConfig'] {
    switch (verdict) {
      case 'PRODUCTION_READY':
        return {
          showToUser: true,
          badgeColor: 'green',
        };
      case 'EXPERIMENT_ONLY':
        return {
          showToUser: true,
          badgeColor: 'yellow',
          warningText: 'Experimental - use with caution',
        };
      case 'REJECTED':
        return {
          showToUser: false,
          badgeColor: 'red',
        };
      case 'DISABLED':
        return {
          showToUser: false,
          badgeColor: 'gray',
        };
    }
  }

  /**
   * Static convenience method
   */
  static evaluate(input: VerdictInput): VerdictResult {
    const service = new StrategyVerdictService();
    return service.evaluate(input);
  }
}

export default StrategyVerdictService;
