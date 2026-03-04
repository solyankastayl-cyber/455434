/**
 * BLOCK 34.12 — OOS (Out-of-Sample) Final Robustness Gate
 * 
 * 4 Walk-Forward Splits covering different market regimes:
 * S1: Bear → Recovery (2014-2016)
 * S2: Bubble + Crash (2017-2019)  
 * S3: Bull + Chop (2020-2022)
 * S4: Modern regime (2023-2026)
 * 
 * Rule: Parameters are FROZEN (v1 config), we only test robustness.
 */

export interface OOSSplit {
  name: string;
  train: [string, string];  // [from, to]
  test: [string, string];   // [from, to]
  regime: string;           // Market regime description
  expectedTrades: number;   // Scaled to period length
}

/**
 * 4 OOS Validation Splits (BLOCK 34.12)
 * Walk-forward: Train до начала test (expanding)
 */
export const OOS_SPLITS: OOSSplit[] = [
  {
    name: "S1_BEAR_RECOVERY",
    train: ["2010-01-01", "2013-12-31"],
    test: ["2014-01-01", "2016-12-31"],
    regime: "Bear → Recovery",
    expectedTrades: 20  // 3 years
  },
  {
    name: "S2_BUBBLE_CRASH",
    train: ["2010-01-01", "2016-12-31"],
    test: ["2017-01-01", "2019-12-31"],
    regime: "Bubble + Crash",
    expectedTrades: 20  // 3 years
  },
  {
    name: "S3_BULL_CHOP",
    train: ["2010-01-01", "2019-12-31"],
    test: ["2020-01-01", "2022-12-31"],
    regime: "Bull + Chop",
    expectedTrades: 20  // 3 years
  },
  {
    name: "S4_MODERN",
    train: ["2010-01-01", "2022-12-31"],
    test: ["2023-01-01", "2026-02-15"],
    regime: "Modern regime",
    expectedTrades: 20  // ~3 years
  }
];

/**
 * BLOCK 34.12.1 — Fixed v1 Configuration
 * FROZEN. NO SWEEP. Production candidate.
 */
export const FIXED_CONFIG = {
  // Signal params (v1)
  signal: {
    windowLen: 60,
    minSimilarity: 0.40,
    minMatches: 6,
    horizonDays: 14,
    useRelative: true,
    baselineLookbackDays: 720,
    similarityMode: 'raw_returns' as const
  },
  // Risk/Gate params (from previous optimization)
  gate: {
    minEnter: 0.25,
    minFull: 0.70,
    minFlip: 0.40,
    softGate: true
  },
  risk: {
    soft: 0.08,
    hard: 0.20,
    taper: 0.85
  }
};

/**
 * BLOCK 34.12.3 — Pass/Fail Thresholds (Production-grade)
 */
export const OOS_THRESHOLDS = {
  minSharpe: 0.35,       // OOS жёстче не делаем
  maxDD: 0.35,           // Maximum drawdown (35%)
  minTrades: 12,         // Minimum для 2-летнего окна
  minTradesPerYear: 6,   // Альтернатива: trades/years >= 6
  minPassSplits: 3,      // Минимум 3 из 4 сплитов должны пройти
  worstSharpeFloor: -0.2 // Ни в одном окне Sharpe не < -0.2 при trades >= 15
};
