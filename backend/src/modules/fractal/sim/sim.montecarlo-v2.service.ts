/**
 * BLOCK 36.8 — V2 Monte Carlo Block Bootstrap
 * 
 * Validates V2 multi-horizon strategy robustness.
 * 
 * KEY DIFFERENCES from V1 MC:
 * - Tests decision SEQUENCE (LONG/SHORT/FLAT) not just returns
 * - Uses ONLY block bootstrap (no permutation - preserves regime structure)
 * - Longer block sizes (5, 7, 10) for regime-dependent strategy
 * - Computes tail risk distribution (DD > 35%, 45%, 55%)
 * 
 * Input: trades array from multi-horizon simulation
 * Output: Statistical validation with P95 MaxDD, Worst Sharpe, etc.
 * 
 * ACCEPTANCE CRITERIA:
 * - P95 MaxDD ≤ 35%
 * - Worst MaxDD ≤ 50%
 * - Worst Sharpe ≥ 0
 * - P05 CAGR ≥ 5%
 */

import type { SimTrade } from './sim.montecarlo.js';

// ═══════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════

export interface MonteCarloV2Input {
  trades: SimTrade[];
  initialEquity?: number;      // default 1.0
  iterations?: number;         // default 3000
  blockSizes?: number[];       // default [5, 7, 10]
  seed?: number;               // optional for reproducibility
  yearsForCAGR?: number;       // years for CAGR calc (default: auto from trades)
}

export interface BlockSizeResult {
  blockSize: number;
  iterations: number;
  tradeCount: number;

  maxDD: {
    p05: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
  };

  sharpe: {
    p05: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
  };

  cagr: {
    p05: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
  };

  finalEquity: {
    p05: number;
    p50: number;
    p95: number;
    min: number;
    max: number;
    mean: number;
  };

  worstCases: {
    worstSharpe: { value: number; iter: number };
    worstDD: { value: number; iter: number };
    worstCAGR: { value: number; iter: number };
  };

  tailRisk: {
    ddOver35pct: number;   // % of iterations with DD > 35%
    ddOver45pct: number;   // % of iterations with DD > 45%
    ddOver55pct: number;   // % of iterations with DD > 55%
  };
}

export interface MonteCarloV2Result {
  ok: boolean;
  version: 2;
  mode: 'block_bootstrap';
  totalIterations: number;
  tradeCount: number;

  blockResults: BlockSizeResult[];

  // Aggregated metrics (worst-case across all block sizes)
  aggregated: {
    p95MaxDD: number;
    worstMaxDD: number;
    worstSharpe: number;
    p05CAGR: number;
    medianSharpe: number;
  };

  // Acceptance criteria check
  acceptance: {
    p95MaxDD: { value: number; target: number; pass: boolean };
    worstMaxDD: { value: number; target: number; pass: boolean };
    worstSharpe: { value: number; target: number; pass: boolean };
    p05CAGR: { value: number; target: number; pass: boolean };
    overallPass: boolean;
  };

  // Tail risk distribution (worst across block sizes)
  tailRisk: {
    ddOver35pct: number;
    ddOver45pct: number;
    ddOver55pct: number;
  };

  verdict: string;
  executionTimeMs: number;
}

// ═══════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const w = idx - lo;
  return sorted[lo] * (1 - w) + sorted[hi] * w;
}

function mean(xs: number[]): number {
  if (!xs.length) return NaN;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  const v = xs.reduce((acc, x) => acc + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

/**
 * Simple LCG for reproducible randomness
 */
function makeRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

/**
 * Fisher-Yates shuffle
 */
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Circular Block Bootstrap: 
 * For short sequences, creates overlapping blocks starting from random positions
 * This is the statistically correct approach for small samples.
 * 
 * Process:
 * 1. Treat the sequence as circular (wraps around)
 * 2. Randomly select N/blockSize start positions
 * 3. Extract blocks of blockSize from each start position
 * 4. Concatenate to form new sequence
 */
function circularBlockBootstrap<T>(arr: T[], blockSize: number, rnd: () => number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  
  // Number of blocks to draw (enough to cover original length)
  const numBlocks = Math.ceil(n / blockSize);
  const result: T[] = [];
  
  for (let b = 0; b < numBlocks; b++) {
    // Random start position in circular array
    const startIdx = Math.floor(rnd() * n);
    
    // Extract block with wrap-around
    for (let i = 0; i < blockSize && result.length < n; i++) {
      const idx = (startIdx + i) % n;
      result.push(arr[idx]);
    }
  }
  
  return result;
}

/**
 * Moving Block Bootstrap (MBB):
 * Creates overlapping blocks of length b from the original sequence.
 * Randomly samples ceil(n/b) blocks with replacement.
 * Better variance properties than non-overlapping block bootstrap.
 */
function movingBlockBootstrap<T>(arr: T[], blockSize: number, rnd: () => number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  if (blockSize >= n) return shuffle(arr, rnd);
  
  // Number of possible starting positions (overlapping)
  const numStartPositions = n - blockSize + 1;
  
  // Number of blocks needed
  const numBlocks = Math.ceil(n / blockSize);
  const result: T[] = [];
  
  for (let b = 0; b < numBlocks; b++) {
    // Randomly select a starting position
    const startIdx = Math.floor(rnd() * numStartPositions);
    
    // Extract block
    for (let i = 0; i < blockSize && result.length < n; i++) {
      result.push(arr[startIdx + i]);
    }
  }
  
  return result;
}

/**
 * Stationary Block Bootstrap:
 * - Block lengths are geometrically distributed with mean = blockSize
 * - This gives smooth transitions and better preserves dependency structure
 * - For short sequences, falls back to full shuffle
 */
function stationaryBlockBootstrap<T>(arr: T[], avgBlockSize: number, rnd: () => number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  if (n <= 5) return shuffle(arr, rnd);
  
  // Probability of starting new block
  const p = 1 / avgBlockSize;
  
  const result: T[] = [];
  let currentStart = Math.floor(rnd() * n);  // Random start
  
  while (result.length < n) {
    // Add current element
    result.push(arr[currentStart]);
    
    // With probability p, jump to new random position
    // Otherwise, continue to next element (with wrap-around)
    if (rnd() < p) {
      currentStart = Math.floor(rnd() * n);
    } else {
      currentStart = (currentStart + 1) % n;
    }
  }
  
  return result;
}

/**
 * Standard Block bootstrap: shuffle blocks of consecutive trades
 * Good for longer sequences, preserves local regime structure
 */
function blockShuffle<T>(arr: T[], blockSize: number, rnd: () => number): T[] {
  const n = arr.length;
  if (n === 0) return [];
  if (blockSize >= n) return shuffle(arr, rnd);
  
  const blocks: T[][] = [];
  for (let i = 0; i < n; i += blockSize) {
    blocks.push(arr.slice(i, Math.min(i + blockSize, n)));
  }
  const shuffledBlocks = shuffle(blocks, rnd);
  return shuffledBlocks.flat();
}

/**
 * Compute path statistics from trade sequence
 * - Max Drawdown
 * - Sharpe ratio (path-based)
 * - Final equity
 */
function computePathStats(
  trades: SimTrade[],
  initialEquity: number,
  years: number
): {
  finalEquity: number;
  maxDD: number;
  sharpe: number;
  cagr: number;
} {
  if (trades.length === 0) {
    return { finalEquity: initialEquity, maxDD: 0, sharpe: 0, cagr: 0 };
  }

  // Build equity curve from trades
  let eq = initialEquity;
  let peak = initialEquity;
  let maxDD = 0;
  const returns: number[] = [];

  for (const trade of trades) {
    const ret = trade.netReturn;
    returns.push(ret);
    eq *= (1 + ret);
    
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  // Path-based Sharpe
  const m = mean(returns);
  const sd = stdev(returns);
  // Annualize: assume each trade is roughly ~30 days, so ~12 trades/year
  const tradesPerYear = trades.length / Math.max(1, years);
  const sharpe = sd > 0 ? (m / sd) * Math.sqrt(tradesPerYear) : 0;

  // CAGR
  const cagr = years > 0 && eq > 0 ? Math.pow(eq / initialEquity, 1 / years) - 1 : 0;

  return { finalEquity: eq, maxDD, sharpe, cagr };
}

// ═══════════════════════════════════════════════════════════════
// MAIN MONTE CARLO V2 FUNCTION
// ═══════════════════════════════════════════════════════════════

export function runMonteCarloV2(input: MonteCarloV2Input): MonteCarloV2Result {
  const startTime = Date.now();
  
  const iterations = input.iterations ?? 3000;
  const initialEquity = input.initialEquity ?? 1.0;
  const seed = input.seed ?? Math.floor(Math.random() * 1e9);
  const blockSizes = input.blockSizes ?? [5, 7, 10];
  
  // Calculate years from trade dates
  let years = input.yearsForCAGR ?? 0;
  if (years === 0 && input.trades.length > 1) {
    const firstDate = new Date(input.trades[0].entryTs).getTime();
    const lastDate = new Date(input.trades[input.trades.length - 1].exitTs).getTime();
    years = Math.max(1, (lastDate - firstDate) / (365.25 * 24 * 60 * 60 * 1000));
  }
  if (years === 0) years = 7; // fallback

  const tradeCount = input.trades.length;
  
  console.log(`[MC V2 36.8] Starting Monte Carlo V2: ${iterations} iterations per block size`);
  console.log(`[MC V2 36.8] Trades: ${tradeCount}, Block sizes: [${blockSizes.join(', ')}], Years: ${years.toFixed(1)}`);
  console.log(`[MC V2 36.8] Method: Stationary Block Bootstrap (geometric block lengths)`);

  if (tradeCount < 5) {
    return {
      ok: false,
      version: 2,
      mode: 'block_bootstrap',
      totalIterations: 0,
      tradeCount,
      blockResults: [],
      aggregated: {
        p95MaxDD: NaN,
        worstMaxDD: NaN,
        worstSharpe: NaN,
        p05CAGR: NaN,
        medianSharpe: NaN,
      },
      acceptance: {
        p95MaxDD: { value: NaN, target: 0.35, pass: false },
        worstMaxDD: { value: NaN, target: 0.50, pass: false },
        worstSharpe: { value: NaN, target: 0, pass: false },
        p05CAGR: { value: NaN, target: 0.05, pass: false },
        overallPass: false,
      },
      tailRisk: { ddOver35pct: 100, ddOver45pct: 100, ddOver55pct: 100 },
      verdict: '🔴 INSUFFICIENT TRADES — Need at least 5 trades for MC validation',
      executionTimeMs: Date.now() - startTime,
    };
  }

  const rnd = makeRng(seed);
  const blockResults: BlockSizeResult[] = [];

  // Run MC for each block size
  for (const blockSize of blockSizes) {
    console.log(`[MC V2 36.8] Running block size ${blockSize}...`);

    const equities: number[] = [];
    const dds: number[] = [];
    const sharpes: number[] = [];
    const cagrs: number[] = [];

    let worstSharpe = { value: Infinity, iter: -1 };
    let worstDD = { value: -Infinity, iter: -1 };
    let worstCAGR = { value: Infinity, iter: -1 };

    let ddOver35 = 0;
    let ddOver45 = 0;
    let ddOver55 = 0;

    for (let k = 0; k < iterations; k++) {
      // Stationary Block Bootstrap: block lengths are geometrically distributed
      // This provides better variance while preserving local dependency structure
      const shuffledTrades = stationaryBlockBootstrap(input.trades, blockSize, rnd);
      
      // Compute stats for this shuffled sequence
      const stats = computePathStats(shuffledTrades, initialEquity, years);

      equities.push(stats.finalEquity);
      dds.push(stats.maxDD);
      sharpes.push(stats.sharpe);
      cagrs.push(stats.cagr);

      // Track worst cases
      if (stats.sharpe < worstSharpe.value) worstSharpe = { value: stats.sharpe, iter: k };
      if (stats.maxDD > worstDD.value) worstDD = { value: stats.maxDD, iter: k };
      if (stats.cagr < worstCAGR.value) worstCAGR = { value: stats.cagr, iter: k };

      // Track tail risk
      if (stats.maxDD > 0.35) ddOver35++;
      if (stats.maxDD > 0.45) ddOver45++;
      if (stats.maxDD > 0.55) ddOver55++;
    }

    // Sort for percentile calculations
    const eqS = equities.slice().sort((a, b) => a - b);
    const ddS = dds.slice().sort((a, b) => a - b);
    const shS = sharpes.slice().sort((a, b) => a - b);
    const cagrS = cagrs.slice().sort((a, b) => a - b);

    blockResults.push({
      blockSize,
      iterations,
      tradeCount,
      maxDD: {
        p05: Math.round(percentile(ddS, 0.05) * 10000) / 10000,
        p50: Math.round(percentile(ddS, 0.50) * 10000) / 10000,
        p95: Math.round(percentile(ddS, 0.95) * 10000) / 10000,
        min: Math.round(ddS[0] * 10000) / 10000,
        max: Math.round(ddS[ddS.length - 1] * 10000) / 10000,
        mean: Math.round(mean(ddS) * 10000) / 10000,
      },
      sharpe: {
        p05: Math.round(percentile(shS, 0.05) * 1000) / 1000,
        p50: Math.round(percentile(shS, 0.50) * 1000) / 1000,
        p95: Math.round(percentile(shS, 0.95) * 1000) / 1000,
        min: Math.round(shS[0] * 1000) / 1000,
        max: Math.round(shS[shS.length - 1] * 1000) / 1000,
        mean: Math.round(mean(shS) * 1000) / 1000,
      },
      cagr: {
        p05: Math.round(percentile(cagrS, 0.05) * 10000) / 10000,
        p50: Math.round(percentile(cagrS, 0.50) * 10000) / 10000,
        p95: Math.round(percentile(cagrS, 0.95) * 10000) / 10000,
        min: Math.round(cagrS[0] * 10000) / 10000,
        max: Math.round(cagrS[cagrS.length - 1] * 10000) / 10000,
        mean: Math.round(mean(cagrS) * 10000) / 10000,
      },
      finalEquity: {
        p05: Math.round(percentile(eqS, 0.05) * 10000) / 10000,
        p50: Math.round(percentile(eqS, 0.50) * 10000) / 10000,
        p95: Math.round(percentile(eqS, 0.95) * 10000) / 10000,
        min: Math.round(eqS[0] * 10000) / 10000,
        max: Math.round(eqS[eqS.length - 1] * 10000) / 10000,
        mean: Math.round(mean(eqS) * 10000) / 10000,
      },
      worstCases: {
        worstSharpe: { value: Math.round(worstSharpe.value * 1000) / 1000, iter: worstSharpe.iter },
        worstDD: { value: Math.round(worstDD.value * 10000) / 10000, iter: worstDD.iter },
        worstCAGR: { value: Math.round(worstCAGR.value * 10000) / 10000, iter: worstCAGR.iter },
      },
      tailRisk: {
        ddOver35pct: Math.round((ddOver35 / iterations) * 10000) / 100,
        ddOver45pct: Math.round((ddOver45 / iterations) * 10000) / 100,
        ddOver55pct: Math.round((ddOver55 / iterations) * 10000) / 100,
      },
    });

    console.log(`[MC V2 36.8] Block ${blockSize}: P95 MaxDD=${(percentile(ddS, 0.95) * 100).toFixed(1)}%, Median Sharpe=${percentile(shS, 0.50).toFixed(3)}`);
  }

  // Aggregate worst-case metrics across all block sizes
  const allP95MaxDD = blockResults.map(r => r.maxDD.p95);
  const allWorstMaxDD = blockResults.map(r => r.maxDD.max);
  const allWorstSharpe = blockResults.map(r => r.worstCases.worstSharpe.value);
  const allP05CAGR = blockResults.map(r => r.cagr.p05);
  const allMedianSharpe = blockResults.map(r => r.sharpe.p50);

  const aggregatedP95MaxDD = Math.max(...allP95MaxDD);
  const aggregatedWorstMaxDD = Math.max(...allWorstMaxDD);
  const aggregatedWorstSharpe = Math.min(...allWorstSharpe);
  const aggregatedP05CAGR = Math.min(...allP05CAGR);
  const aggregatedMedianSharpe = mean(allMedianSharpe);

  // Tail risk (worst across block sizes)
  const worstTailDD35 = Math.max(...blockResults.map(r => r.tailRisk.ddOver35pct));
  const worstTailDD45 = Math.max(...blockResults.map(r => r.tailRisk.ddOver45pct));
  const worstTailDD55 = Math.max(...blockResults.map(r => r.tailRisk.ddOver55pct));

  // Acceptance criteria
  const p95MaxDDPass = aggregatedP95MaxDD <= 0.35;
  const worstMaxDDPass = aggregatedWorstMaxDD <= 0.50;
  const worstSharpePass = aggregatedWorstSharpe >= 0;
  const p05CAGRPass = aggregatedP05CAGR >= 0.05;
  const overallPass = p95MaxDDPass && worstMaxDDPass && worstSharpePass && p05CAGRPass;

  // Generate verdict
  let verdict: string;
  if (overallPass) {
    verdict = '✅ V2 MULTI-HORIZON MC CERTIFIED — Strategy is robust';
  } else if (aggregatedP95MaxDD <= 0.40 && aggregatedWorstSharpe >= -0.1) {
    verdict = '🟡 V2 MULTI-HORIZON MARGINAL — Consider entropy guard or position scaling';
  } else {
    verdict = '🔴 V2 MULTI-HORIZON FRAGILE — Assembly needs structural improvements';
  }

  const executionTimeMs = Date.now() - startTime;
  console.log(`[MC V2 36.8] Complete in ${executionTimeMs}ms. Overall: ${overallPass ? 'PASS' : 'FAIL'}`);

  return {
    ok: true,
    version: 2,
    mode: 'block_bootstrap',
    totalIterations: iterations * blockSizes.length,
    tradeCount,
    blockResults,
    aggregated: {
      p95MaxDD: Math.round(aggregatedP95MaxDD * 10000) / 10000,
      worstMaxDD: Math.round(aggregatedWorstMaxDD * 10000) / 10000,
      worstSharpe: Math.round(aggregatedWorstSharpe * 1000) / 1000,
      p05CAGR: Math.round(aggregatedP05CAGR * 10000) / 10000,
      medianSharpe: Math.round(aggregatedMedianSharpe * 1000) / 1000,
    },
    acceptance: {
      p95MaxDD: { 
        value: Math.round(aggregatedP95MaxDD * 10000) / 10000, 
        target: 0.35, 
        pass: p95MaxDDPass 
      },
      worstMaxDD: { 
        value: Math.round(aggregatedWorstMaxDD * 10000) / 10000, 
        target: 0.50, 
        pass: worstMaxDDPass 
      },
      worstSharpe: { 
        value: Math.round(aggregatedWorstSharpe * 1000) / 1000, 
        target: 0, 
        pass: worstSharpePass 
      },
      p05CAGR: { 
        value: Math.round(aggregatedP05CAGR * 10000) / 10000, 
        target: 0.05, 
        pass: p05CAGRPass 
      },
      overallPass,
    },
    tailRisk: {
      ddOver35pct: worstTailDD35,
      ddOver45pct: worstTailDD45,
      ddOver55pct: worstTailDD55,
    },
    verdict,
    executionTimeMs,
  };
}

// ═══════════════════════════════════════════════════════════════
// SERVICE CLASS
// ═══════════════════════════════════════════════════════════════

export class SimMonteCarloV2Service {
  /**
   * Run MC validation on V2 multi-horizon trades
   * This is the main entry point from API
   */
  async runFromMultiHorizonSim(params: {
    start?: string;
    end?: string;
    symbol?: string;
    iterations?: number;
    blockSizes?: number[];
    seed?: number;
  } = {}): Promise<MonteCarloV2Result> {
    // First run the multi-horizon simulation to get trades
    const { SimMultiHorizonService } = await import('./sim.multi-horizon.service.js');
    const simService = new SimMultiHorizonService();

    console.log('[MC V2 36.8] Running multi-horizon simulation first...');
    
    const simResult = await simService.runFull({
      start: params.start ?? '2019-01-01',
      end: params.end ?? '2026-02-15',
      symbol: params.symbol ?? 'BTC',
      stepDays: 7,
    });

    if (!simResult.ok || !simResult.trades?.length) {
      throw new Error('Multi-horizon simulation failed or returned no trades');
    }

    console.log(`[MC V2 36.8] Got ${simResult.trades.length} trades from simulation`);

    // Calculate years from simulation period
    const startDate = new Date(params.start ?? '2019-01-01').getTime();
    const endDate = new Date(params.end ?? '2026-02-15').getTime();
    const yearsForCAGR = (endDate - startDate) / (365.25 * 24 * 60 * 60 * 1000);

    // Run Monte Carlo on the trades
    return runMonteCarloV2({
      trades: simResult.trades,
      iterations: params.iterations ?? 3000,
      blockSizes: params.blockSizes ?? [5, 7, 10],
      seed: params.seed,
      yearsForCAGR,
    });
  }

  /**
   * Run MC directly on provided trades
   */
  runDirect(trades: import('./sim.montecarlo.js').SimTrade[], params: {
    iterations?: number;
    blockSizes?: number[];
    seed?: number;
    yearsForCAGR?: number;
  } = {}): MonteCarloV2Result {
    return runMonteCarloV2({
      trades,
      iterations: params.iterations ?? 3000,
      blockSizes: params.blockSizes ?? [5, 7, 10],
      seed: params.seed,
      yearsForCAGR: params.yearsForCAGR,
    });
  }
}

// Export singleton
export const simMonteCarloV2Service = new SimMonteCarloV2Service();
