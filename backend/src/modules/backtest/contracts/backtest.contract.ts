/**
 * P13: Portfolio Backtest Contracts
 */

// ═══════════════════════════════════════════════════════════════
// REQUEST TYPES
// ═══════════════════════════════════════════════════════════════

export type BacktestRunRequest = {
  id?: string;
  start: string;                       // YYYY-MM-DD
  end: string;                         // YYYY-MM-DD
  step: '1d' | '1w';                   // rebalance frequency
  universe: Array<'spx' | 'btc' | 'cash'>;
  mode: {
    brain: 0 | 1;
    brainMode?: 'on' | 'shadow';
    optimizer: 0 | 1;
    capital?: 0 | 1;                   // v2.3: Enable capital scaling
    capitalMode?: 'on' | 'shadow';     // v2.3: Capital scaling mode
  };
  costs: {
    feeBps: number;                    // e.g. 2 (0.02%)
    slippageBps: number;               // e.g. 5
  };
  constraints: {
    maxLeverage: number;
    minCash?: number;
  };
  pricing: {
    spxSource: 'spx_candles';
    btcSource: 'btc_candles';
    cashAprSource?: 'cash_rate';
  };
  seed?: number;
  asOfSafe: boolean;
  tags?: string[];
};

export type CompareRequest = {
  strategy: BacktestRunRequest;
  baseline: BacktestRunRequest;
};

// ═══════════════════════════════════════════════════════════════
// REPORT TYPES
// ═══════════════════════════════════════════════════════════════

export type BacktestSummary = {
  cagr: number;
  volAnn: number;
  sharpe: number;
  sortino: number;
  maxDrawdown: number;
  calmar: number;
  hitRate: number;
  turnoverAvg: number;
  costImpact: number;
  tailLoss95: number;
  tailLoss99: number;
};

export type BacktestCompare = {
  baselineId: string;
  deltaCagr: number;
  deltaSharpe: number;
  deltaMaxDD: number;
  deltaCalmar: number;
  dominance: 'strategy' | 'baseline' | 'mixed';
  verdict: 'PASS' | 'FAIL' | 'REVIEW';
  reasons: string[];
};

export type BacktestSeries = {
  dates: string[];
  nav: number[];
  returns: number[];
  drawdown: number[];
  weights: {
    spx: number[];
    btc: number[];
    cash: number[];
  };
  turnover: number[];
  scenario?: string[];
  regime?: string[];
};

export type BacktestDiagnostics = {
  determinismHash: string;
  noLookahead: boolean;
  missingData: Array<{ date: string; asset: string; reason: string }>;
  anomalies: Array<{ date: string; type: string; detail: string }>;
};

export type BacktestReport = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  startedAt?: string;
  finishedAt?: string;
  config: BacktestRunRequest;
  summary?: BacktestSummary;
  compare?: BacktestCompare;
  series?: BacktestSeries;
  diagnostics?: BacktestDiagnostics;
  error?: string;
};

export type CompareReport = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  strategyId: string;
  baselineId: string;
  startedAt?: string;
  finishedAt?: string;
  strategy?: BacktestReport;
  baseline?: BacktestReport;
  compare?: BacktestCompare;
};
