/**
 * S1.3 - Strategy Verdict Types
 * 
 * Final verdict for strategy recommendation.
 */

export type StrategyFinalVerdict =
  | 'PRODUCTION_READY'   // Can be recommended to users
  | 'EXPERIMENT_ONLY'    // Show with warning
  | 'REJECTED'           // Do not show
  | 'DISABLED';          // Blocked by guardrails

export interface VerdictInput {
  strategyId: string;
  network: 'ethereum' | 'bnb';
  
  /** From S1.2 Backtest */
  backtestVerdict: 'GOOD' | 'MIXED' | 'BAD' | 'INSUFFICIENT_DATA';
  
  /** From P1.1 Stability */
  stabilityVerdict?: 'STABLE' | 'UNSTABLE' | 'INSUFFICIENT_DATA';
  
  /** From U1.3 Signal Quality */
  signalQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  
  /** From A2 Guardrails */
  guardrailBlocked: boolean;
  guardrailReasons?: string[];
}

export interface VerdictResult {
  strategyId: string;
  strategyName: string;
  network: 'ethereum' | 'bnb';
  
  verdict: StrategyFinalVerdict;
  reasons: string[];
  
  /** Input factors used */
  factors: {
    backtestVerdict: string;
    stabilityVerdict?: string;
    signalQuality: string;
    guardrailBlocked: boolean;
  };
  
  /** Recommendation for UI */
  uiConfig: {
    showToUser: boolean;
    badgeColor: 'green' | 'yellow' | 'red' | 'gray';
    warningText?: string;
  };
  
  createdAt: Date;
}
