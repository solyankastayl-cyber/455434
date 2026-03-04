/**
 * P14: Rolling Metrics Contracts
 */

export type RollingPoint = {
  asOf: string;
  strategy: {
    sharpe: number;
    maxDD: number;
    vol: number;
  };
  baseline: {
    sharpe: number;
    maxDD: number;
    vol: number;
  };
  delta: {
    sharpe: number;
    maxDD: number;
  };
};

export type RollingPack = {
  backtestId: string;
  window: '6m' | '12m';
  points: RollingPoint[];
  stability: {
    avgDeltaSharpe: number;
    minDeltaSharpe: number;
    maxDeltaSharpe: number;
    pctNegativeDelta: number; // % of points where deltaSharpe < 0
    pctBadDelta: number;      // % of points where deltaSharpe < -0.15
  };
};

export type PerformanceMatrix = {
  backtestId: string;
  matrix: Array<{
    macroRegime: string;
    volBucket: string;
    n: number;
    deltaSharpe: number;
    deltaMaxDD: number;
    deltaCagr: number;
  }>;
  overallVerdict: 'PASS' | 'FAIL' | 'REVIEW';
  gates: {
    riskProtection: boolean;    // Gate A
    noBaseUnderperform: boolean; // Gate B
    stability: boolean;          // Gate C
  };
  reasons: string[];
};
