/**
 * BROWNIAN BRIDGE ENGINE V3.10.2
 * ==============================
 * 
 * Generates synthetic daily candles with MARKET-LIKE behavior:
 * - Mix of red and green candles (not monotonic arrow)
 * - Controlled daily volatility caps
 * - Guaranteed target price at end
 * - Premium thin wicks for TradingView look
 */

export type BridgeCandle = {
  time: number;      // unix seconds
  open: number;
  high: number;
  low: number;
  close: number;
};

export type BridgeInput = {
  startPrice: number;      // current price (anchor)
  targetPrice: number;     // predicted target at horizon
  days: number;            // 1 / 7 / 30
  volDailyPct: number;     // daily volatility (e.g. 0.015 = 1.5%)
  seed?: number;           // for deterministic results
  startTime?: number;      // unix seconds (default: now)
};

/**
 * Clamp helper
 */
function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * Mulberry32 - fast deterministic PRNG
 */
function mulberry32(seed: number): () => number {
  return function() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box-Muller transform for N(0,1)
 */
function randn(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/**
 * Generate stable seed from inputs (same day = same result)
 */
function stableSeed(startPrice: number, targetPrice: number, days: number): number {
  const d = new Date();
  const dayStr = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`;
  const key = `${startPrice.toFixed(2)}:${targetPrice.toFixed(2)}:${days}:${dayStr}`;
  
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build market-like bridge prices:
 * - Not monotonic (mix of up/down)
 * - Daily move capped
 * - Final point = targetPrice (guaranteed)
 */
function buildBrownianBridgePrices(params: {
  startPrice: number;
  targetPrice: number;
  steps: number;
  volDaily: number;
  maxDailyMove: number;
  rng: () => number;
}): number[] {
  const { startPrice, targetPrice, steps, volDaily, maxDailyMove, rng } = params;

  const prices: number[] = new Array(steps);
  prices[0] = startPrice;
  
  let currentPrice = startPrice;
  const N = steps - 1;

  // Generate prices with NOISE > DRIFT ratio for market-like behavior
  for (let i = 1; i < steps - 1; i++) {
    const progress = i / N;
    const remainingSteps = N - i;

    // 1️⃣ Drift DECREASES as we approach target (lets noise dominate early)
    const driftStrength = 1 - progress;
    const drift = ((targetPrice - currentPrice) / remainingSteps) * driftStrength;

    // 2️⃣ Noise AMPLIFIED (2.2x multiplier for real market chaos)
    const noise = (rng() - 0.5) * volDaily * currentPrice * 2.2;

    // 3️⃣ Combined step
    let step = drift + noise;

    // 4️⃣ Hard cap on daily move
    const maxMove = currentPrice * maxDailyMove;
    step = Math.max(-maxMove, Math.min(maxMove, step));

    currentPrice += step;
    prices[i] = currentPrice;
  }

  // Last point = targetPrice (HARD guarantee)
  prices[steps - 1] = targetPrice;

  // Backwards correction: ensure no "last candle spike"
  for (let i = steps - 2; i >= 1; i--) {
    const next = prices[i + 1];
    const maxUp = prices[i] * (1 + maxDailyMove);
    const maxDn = prices[i] * (1 - maxDailyMove);

    if (next > maxUp) prices[i] = next / (1 + maxDailyMove);
    if (next < maxDn) prices[i] = next / (1 - maxDailyMove);
  }

  return prices;
}

/**
 * Convert prices array to TradingView-style candles
 */
function pricesToCandles(
  prices: number[], 
  startTimeSec: number, 
  stepSec: number,
  rng: () => number
): BridgeCandle[] {
  const candles: BridgeCandle[] = [];

  for (let i = 1; i < prices.length; i++) {
    const open = prices[i - 1];
    const close = prices[i];

    const body = Math.abs(close - open);
    const mid = (open + close) / 2;

    // Premium thin wicks: max 25% of body OR 0.25% of price
    const wickAbs = Math.min(body * 0.25, mid * 0.0025) * (0.5 + rng() * 0.5);

    const high = Math.max(open, close) + wickAbs;
    const low = Math.min(open, close) - wickAbs;

    candles.push({
      time: startTimeSec + (i - 1) * stepSec,
      open,
      high,
      low,
      close,
    });
  }

  return candles;
}

/**
 * Main entry point: Build Brownian Bridge candles
 * 
 * V3.10.2: Market-like behavior with red/green mix
 */
export function buildBrownianBridgeCandles(input: BridgeInput): BridgeCandle[] {
  const { startPrice, targetPrice, days, volDailyPct } = input;
  
  // Deterministic seed
  const seed = input.seed ?? stableSeed(startPrice, targetPrice, days);
  const rng = mulberry32(seed);
  
  // Daily move caps by horizon
  const maxDailyMoveByHorizon: Record<number, number> = {
    1: 0.010,   // 1D: 1.0% cap
    2: 0.010,   // 1D generates 2 points
    7: 0.012,   // 7D: 1.2% cap
    8: 0.012,   // 7D generates 8 points
    30: 0.014,  // 30D: 1.4% cap
    31: 0.014,  // 30D generates 31 points
  };
  const maxDailyMove = maxDailyMoveByHorizon[days] ?? 0.012;
  
  // Generate price path (N+1 points for N days)
  const steps = days + 1;
  const prices = buildBrownianBridgePrices({
    startPrice,
    targetPrice,
    steps,
    volDaily: volDailyPct,
    maxDailyMove,
    rng,
  });
  
  // Convert to candles
  const daySec = 86400;
  const now = input.startTime ?? Math.floor(Date.now() / 1000);
  const baseTime = now - (now % daySec);
  
  const candles = pricesToCandles(prices, baseTime, daySec, rng);
  
  return candles;
}

/**
 * Estimate daily volatility from recent closes
 */
export function estimateDailyVolPct(closes: number[]): number {
  if (!closes || closes.length < 5) return 0.015;
  
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) {
      rets.push(Math.log(closes[i] / closes[i - 1]));
    }
  }
  
  if (rets.length < 3) return 0.015;
  
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const std = Math.sqrt(variance);
  
  return clamp(0.003, 0.06, std);
}

console.log('[BrownianBridgeEngine] Module loaded (V3.10.2 - Market-like candles)');
