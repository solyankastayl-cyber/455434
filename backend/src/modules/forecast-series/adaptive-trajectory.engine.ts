/**
 * ADAPTIVE TRAJECTORY ENGINE V3.11
 * =================================
 * 
 * Generates market-like candles that:
 * - React to quality/drift/health state
 * - Use 7D bias to adjust 30D/1D trajectories
 * - Guarantee target price at end
 * - Have realistic red/green mix with reversals
 * 
 * Key insight: trendWeight depends on model health,
 * noiseWeight increases when model is degraded.
 */

export type DriftState = 'HEALTHY' | 'DEGRADING' | 'CRITICAL';
export type QualityState = 'GOOD' | 'NEUTRAL' | 'WEAK';
export type HealthState = 'HEALTHY' | 'DEGRADED' | 'CRITICAL';

export type AdaptiveTrajectoryInput = {
  startPrice: number;
  targetPrice: number;
  steps: number;              // 1D=2, 7D=8, 30D=31
  volDaily: number;           // 0..1 normalized or actual (will be clamped)
  confidence: number;         // adjusted confidence 0..1
  quality: QualityState;
  drift: DriftState;
  health: HealthState;
  bias7d: number;             // signed [-0.25..0.25], influences 30D/1D
  seed: number;               // for deterministic results
};

export type AdaptiveTrajectoryResult = {
  candles: Array<{ time?: number; open: number; high: number; low: number; close: number }>;
  target: number;
  trendWeight: number;
  noiseWeight: number;
  bias7d: number;
  effectiveBias: number;
  horizonBiasMult: number;
  simulation: boolean;
};

function clamp(min: number, max: number, v: number): number {
  return Math.max(min, Math.min(max, v));
}

// Simple deterministic PRNG
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build adaptive trajectory with learning integration
 * 
 * V3.11: Simulation mode for testing learning impact
 */
export function buildAdaptiveTrajectory(input: AdaptiveTrajectoryInput): AdaptiveTrajectoryResult {
  const {
    startPrice,
    targetPrice,
    steps,
    volDaily,
    confidence,
    quality,
    drift,
    health,
    bias7d,
    seed,
  } = input;

  const rnd = mulberry32(seed);

  // === SIMULATION MODE CONFIG ===
  const SIM_ENABLED = process.env.FORECAST_LEARNING_SIMULATION === 'true';
  const SIM_MULT = Number(process.env.FORECAST_LEARNING_SIM_MULT || 1);
  const SIM_FORCE = process.env.FORECAST_LEARNING_SIM_FORCE_BIAS === 'true';
  const SIM_FORCE_VALUE = Number(process.env.FORECAST_LEARNING_SIM_FORCE_VALUE || 0);

  // === 1) Calculate effective bias ===
  let effectiveBias = bias7d || 0;

  if (SIM_ENABLED) {
    if (SIM_FORCE) {
      // Force a specific bias for testing
      effectiveBias = SIM_FORCE_VALUE;
    } else {
      // Amplify real bias
      effectiveBias = effectiveBias * SIM_MULT;
    }
    // Hard cap
    effectiveBias = clamp(-0.4, 0.4, effectiveBias);
  }

  // === 2) State multipliers (learning affects trajectory shape) ===
  const qMult = quality === 'GOOD' ? 1.0 : quality === 'NEUTRAL' ? 0.85 : 0.65;
  const dMult = drift === 'HEALTHY' ? 1.0 : drift === 'DEGRADING' ? 0.8 : 0.6;
  const hMult = health === 'HEALTHY' ? 1.0 : health === 'DEGRADED' ? 0.7 : 0.45;

  // Trend stronger with high confidence, but cut by weak states
  let trendWeight = clamp(0.15, 1.0, (0.35 + 0.65 * confidence) * qMult * dMult * hMult);

  // Noise higher with bad states (more chaotic when model is uncertain)
  let noiseWeight = clamp(0.35, 1.6, (1 / qMult) * (1 / dMult) * (1 / hMult));

  // === SIMULATION MODE: Amplify effects ===
  if (SIM_ENABLED) {
    trendWeight = trendWeight * 2.2;  // Stronger directional trend
    noiseWeight = noiseWeight * 0.5;  // Less chaos, clearer signal
  }

  // === 3) Bias correction from 7D outcomes ===
  // Use effectiveBias (which may be amplified in sim mode)
  const horizonBiasMult =
    steps >= 31 ? clamp(0.60, 1.40, 1 + 1.0 * effectiveBias) :  // 30D: ±40%
    steps >= 8  ? clamp(0.70, 1.30, 1 + 0.8 * effectiveBias) :  // 7D: ±30%
                  clamp(0.80, 1.20, 1 + 0.5 * effectiveBias);   // 1D: ±20%

  const finalTarget = startPrice + (targetPrice - startPrice) * horizonBiasMult;

  // === 4) Generate trajectory in log-returns for market-like behavior ===
  const s0 = startPrice;
  const sT = finalTarget;

  const totalLog = Math.log(sT / s0);
  const mu = (totalLog / (steps - 1)) * trendWeight;

  // Base daily volatility (clamped for safety)
  const baseVol = clamp(0.0015, 0.02, 0.006 * clamp(0.1, 2.0, volDaily)) * noiseWeight;

  // Daily move caps by horizon
  const maxBodyPct =
    steps >= 31 ? 0.014 :  // 30D: 1.4% max/day
    steps >= 8  ? 0.012 :  // 7D: 1.2%
                  0.010;   // 1D: 1.0%

  const maxWickPct =
    steps >= 31 ? 0.003 :
    steps >= 8  ? 0.003 :
                  0.0025;

  const closes: number[] = new Array(steps);
  closes[0] = s0;

  // === 4) Generate: trend + noise + zigzag for red candles ===
  for (let i = 1; i < steps; i++) {
    // Zigzag: alternating sign bias for red/green mix
    const zig = (i % 2 === 0 ? 1 : -1) * (0.35 + 0.65 * rnd());
    const eps = (rnd() - 0.5) * 2; // [-1..1]

    // Log return
    const logRet = mu + eps * baseVol + zig * baseVol * 0.55;

    // Convert to price
    const prev = closes[i - 1];
    let next = prev * Math.exp(logRet);

    // Daily cap
    const capUp = prev * (1 + maxBodyPct);
    const capDn = prev * (1 - maxBodyPct);
    next = clamp(capDn, capUp, next);

    closes[i] = next;
  }

  // === 5) Guarantee exact target: backward correction ===
  const last = closes[steps - 1];
  const fixLog = Math.log(sT / last);
  
  // Distribute correction across tail to avoid spike
  const tail = Math.min(10, steps - 1);
  const weightSum = (tail * (tail + 1)) / 2;
  
  for (let k = 0; k < tail; k++) {
    const i = (steps - 1) - k;
    const w = (tail - k) / weightSum;
    closes[i] = closes[i] * Math.exp(fixLog * w);
  }
  closes[steps - 1] = sT;

  // === 6) Build OHLC candles (market-like) ===
  const candles: AdaptiveTrajectoryResult['candles'] = [];
  
  for (let i = 0; i < steps; i++) {
    const open = i === 0 ? closes[0] : closes[i - 1];
    const close = closes[i];

    const body = Math.abs(close - open);
    const mid = (open + close) / 2;

    // Wicks: 10-25% of body, capped by maxWickPct
    const wickBase = clamp(0.0005, maxWickPct, (body / mid) * 0.20);
    const wickRnd = 0.4 + 0.6 * rnd();
    const wickPct = clamp(0.0005, maxWickPct, wickBase * wickRnd);

    const high = Math.max(open, close) * (1 + wickPct);
    const low = Math.min(open, close) * (1 - wickPct);

    candles.push({ open, high, low, close });
  }

  // Simulation mode indicator
  const simulation = process.env.FORECAST_LEARNING_SIMULATION === 'true';

  return {
    candles,
    target: sT,
    trendWeight,
    noiseWeight,
    bias7d,
    effectiveBias: simulation ? (process.env.FORECAST_LEARNING_SIM_FORCE_BIAS === 'true' 
      ? Number(process.env.FORECAST_LEARNING_SIM_FORCE_VALUE || 0) 
      : (bias7d || 0) * Number(process.env.FORECAST_LEARNING_SIM_MULT || 1)) : bias7d,
    horizonBiasMult,
    simulation,
  };
}

/**
 * Generate stable seed from date (same day = same trajectory)
 */
export function daySeedUTC(offset: number = 0): number {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  return y * 10000 + m * 100 + da + offset;
}

console.log('[AdaptiveTrajectory] Engine loaded (V3.11)');
