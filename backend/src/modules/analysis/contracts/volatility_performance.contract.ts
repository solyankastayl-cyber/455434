/**
 * P14: Volatility Performance Contracts
 */

import type { PerfStats } from './regime_performance.contract.js';

export type VolBucket = 'LOW' | 'MID' | 'HIGH';

export type VolatilityBucket = {
  bucket: VolBucket;
  bounds: {
    lo: number;  // lower vol bound
    hi: number;  // upper vol bound
  };
  strategy: PerfStats;
  baseline: PerfStats;
  delta: {
    cagr: number;
    sharpe: number;
    maxDD: number;
    tailLoss99: number;
  };
};

export type VolatilityPerformancePack = {
  backtestId: string;
  volSpec: {
    windowDays: number;      // e.g., 30
    asset: 'spx' | 'portfolio';
    bucketQuantiles: [number, number]; // e.g., [0.3, 0.7]
  };
  buckets: VolatilityBucket[];
  insight: {
    strategyBetterInHighVol: boolean;
    strategyWorseInLowVol: boolean;
    volatilityEdge: number; // delta Sharpe in HIGH - delta Sharpe in LOW
  };
};
