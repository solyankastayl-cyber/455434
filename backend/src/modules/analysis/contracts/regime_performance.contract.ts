/**
 * P14: Regime Performance Contracts
 */

export type Scenario = 'BASE' | 'RISK' | 'TAIL';
export type MacroRegime = 'EASING' | 'TIGHTENING' | 'STRESS' | 'NEUTRAL' | 'NEUTRAL_MIXED';
export type Guard = 'NONE' | 'WARN' | 'CRISIS' | 'BLOCK';
export type CrossAsset = 'RISK_ON_SYNC' | 'RISK_OFF_SYNC' | 'FLIGHT_TO_QUALITY' | 'DECOUPLED' | 'MIXED';

export type PerfStats = {
  n: number;           // number of periods in slice
  cagr: number;        // compound annual growth rate
  sharpe: number;      // risk-adjusted return
  maxDD: number;       // max drawdown
  tailLoss99: number;  // 1% worst loss
  avgExposure: number; // avg (spx + btc)
  avgCash: number;     // avg cash weight
};

export type SliceKey =
  | { type: 'scenario'; scenario: Scenario }
  | { type: 'macroRegime'; regime: MacroRegime }
  | { type: 'guard'; guard: Guard }
  | { type: 'crossAsset'; crossAsset: CrossAsset };

export type PerformanceSlice = {
  key: SliceKey;
  strategy: PerfStats;
  baseline: PerfStats;
  delta: {
    cagr: number;
    sharpe: number;
    maxDD: number;      // negative = strategy better
    tailLoss99: number; // positive = strategy better (less loss)
  };
};

export type RegimePerformancePack = {
  backtestId: string;
  period: {
    start: string;
    end: string;
    freq: 'daily' | 'weekly';
  };
  slices: PerformanceSlice[];
  summary: {
    totalPeriods: number;
    strategyWinsRisk: boolean;  // strategy better on MaxDD/TailLoss
    baselineWinsReturn: boolean; // baseline better on CAGR
  };
  notes: {
    costBps: number;
    annualizationFactor: number;
  };
};
