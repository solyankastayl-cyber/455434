/**
 * BLOCK 58 — Hierarchical Resolver Service
 * 
 * Institutional-grade decision engine:
 * - Bias (global) from 180d + 365d
 * - Timing (entry/exit) from 7d + 14d + 30d
 * - Final (combined action + size multiplier)
 * 
 * Key principle: Model doesn't "choose", it "constrains"
 * - Macro sets: can we long at all, max risk
 * - Medium sets: position bias, size
 * - Tactical sets: entry/exit timing
 */

import {
  BIAS_HORIZONS,
  TIMING_HORIZONS,
  BIAS_WEIGHTS,
  TIMING_WEIGHTS,
  type HorizonKey,
} from '../../config/horizon.config.js';

import type {
  BiasResolved,
  FinalResolved,
  HierarchicalResolveInput,
  HorizonInput,
  HorizonResolvedComponent,
  ResolvedDecision,
  TimingResolved,
} from './resolver.types.js';

// ═══════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function normalizeWeights(
  w: Record<HorizonKey, number>,
  keys: HorizonKey[]
): Record<HorizonKey, number> {
  const s = keys.reduce((acc, k) => acc + (w[k] ?? 0), 0);
  const out: Record<HorizonKey, number> = {
    "7d": 0, "14d": 0, "30d": 0, "90d": 0, "180d": 0, "365d": 0
  };
  
  if (s <= 0) {
    const eq = 1 / keys.length;
    keys.forEach(k => out[k] = eq);
    return out;
  }
  
  keys.forEach(k => out[k] = (w[k] ?? 0) / s);
  return out;
}

function deriveSignedEdge(h: HorizonInput): number {
  // If pre-computed, use it
  if (typeof h.signedEdge === 'number' && Number.isFinite(h.signedEdge)) {
    return Math.max(-1, Math.min(1, h.signedEdge));
  }

  const conf = clamp01(h.confidence ?? 0);
  const er = (typeof h.expectedReturn === 'number' && Number.isFinite(h.expectedReturn))
    ? h.expectedReturn
    : 0;

  // Direction from dir or sign of expectedReturn
  let sign = 0;
  if (h.dir === 'LONG') sign = 1;
  else if (h.dir === 'SHORT') sign = -1;
  else if (er > 0) sign = 1;
  else if (er < 0) sign = -1;

  // Edge magnitude: bounded mapping of expected return * confidence
  // Conservative and stable
  const mag = Math.tanh(Math.abs(er) * 3) * conf;
  return Math.max(-1, Math.min(1, sign * mag));
}

function dominantByAbsContribution(comps: HorizonResolvedComponent[]): HorizonKey {
  let best: HorizonKey = comps[0]?.horizon ?? "30d";
  let bestVal = -1;
  
  for (const c of comps) {
    const v = Math.abs(c.contribution);
    if (v > bestVal) {
      bestVal = v;
      best = c.horizon;
    }
  }
  return best;
}

function entropyPenalty(entropy?: number): number {
  // Entropy near 1 => high disagreement => bigger penalty
  const e = clamp01(entropy ?? 0);
  return clamp01(Math.pow(e, 1.2));
}

function tailPenalty(mcP95_DD?: number): number {
  // Translate P95 DD into [0..1] penalty; target 0.35
  const dd = clamp01(mcP95_DD ?? 0);
  const target = 0.35;
  if (dd <= target) return 0;
  const x = (dd - target) / (1 - target);
  return clamp01(Math.pow(x, 0.85));
}

// ═══════════════════════════════════════════════════════════════
// MAIN SERVICE
// ═══════════════════════════════════════════════════════════════

export class HierarchicalResolverService {
  private readonly biasKeys: HorizonKey[] = BIAS_HORIZONS;
  private readonly timingKeys: HorizonKey[] = TIMING_HORIZONS;
  private readonly biasWeightsRaw = BIAS_WEIGHTS;
  private readonly timingWeightsRaw = TIMING_WEIGHTS;

  /**
   * Main entry point: resolve all horizons into one decision
   */
  resolve(input: HierarchicalResolveInput): ResolvedDecision {
    const biasW = normalizeWeights(this.biasWeightsRaw, this.biasKeys);
    const timingW = normalizeWeights(this.timingWeightsRaw, this.timingKeys);

    const entPen = entropyPenalty(input.globalEntropy);
    const tPen = tailPenalty(input.mcP95_DD);

    const bias = this.computeBias(input, biasW, entPen, tPen);
    const timing = this.computeTiming(input, timingW, entPen, tPen);
    const final = this.computeFinal(bias, timing, entPen, tPen);

    return { bias, timing, final };
  }

  /**
   * Compute global bias from long horizons (180d, 365d)
   */
  private computeBias(
    input: HierarchicalResolveInput,
    weights: Record<HorizonKey, number>,
    entPen: number,
    tPen: number
  ): BiasResolved {
    const comps: HorizonResolvedComponent[] = [];
    let score = 0;

    for (const k of this.biasKeys) {
      const h = input.horizons[k] ?? { horizon: k };
      const w = weights[k] ?? 0;
      const conf = clamp01(h.confidence ?? 0);
      const rel = clamp01(h.reliability ?? 0);
      const pr = clamp01(h.phaseRisk ?? 0);
      const se = deriveSignedEdge(h);
      const contrib = w * se * conf * rel * (1 - pr);

      comps.push({
        horizon: k,
        weight: w,
        signedEdge: se,
        confidence: conf,
        reliability: rel,
        phaseRisk: pr,
        contribution: contrib
      });
      
      score += contrib;
    }

    // Bias is lightly penalized by entropy/tail (long-term more stable)
    score *= (1 - 0.25 * entPen);
    score *= (1 - 0.25 * tPen);

    const strength = clamp01(Math.abs(score));

    const dir: BiasResolved["dir"] =
      score > 0.15 ? "BULL" :
      score < -0.15 ? "BEAR" :
      "NEUTRAL";

    return {
      dir,
      score,
      strength,
      dominantHorizon: dominantByAbsContribution(comps),
      components: comps
    };
  }

  /**
   * Compute timing (entry/exit) from short horizons (7d, 14d, 30d)
   */
  private computeTiming(
    input: HierarchicalResolveInput,
    weights: Record<HorizonKey, number>,
    entPen: number,
    tPen: number
  ): TimingResolved {
    const comps: HorizonResolvedComponent[] = [];
    let score = 0;
    const blockersSet = new Set<string>();

    for (const k of this.timingKeys) {
      const h = input.horizons[k] ?? { horizon: k };
      const w = weights[k] ?? 0;
      const conf = clamp01(h.confidence ?? 0);
      const rel = clamp01(h.reliability ?? 0);
      const pr = clamp01(h.phaseRisk ?? 0);
      const se = deriveSignedEdge(h);
      const contrib = w * se * conf * rel * (1 - pr);

      if (h.blockers?.length) {
        h.blockers.forEach(b => blockersSet.add(b));
      }

      comps.push({
        horizon: k,
        weight: w,
        signedEdge: se,
        confidence: conf,
        reliability: rel,
        phaseRisk: pr,
        contribution: contrib
      });

      score += contrib;
    }

    // Timing is sensitive to entropy/tail (avoid bad entries)
    score *= (1 - entPen);
    score *= (1 - tPen);

    const strength = clamp01(Math.abs(score));

    // Hard blockers force WAIT
    const hardBlockers = ["LOW_CONFIDENCE", "HIGH_ENTROPY", "HIGH_TAIL_RISK"];
    const hasHard = hardBlockers.some(b => blockersSet.has(b));

    let action: TimingResolved["action"] = "WAIT";
    if (!hasHard) {
      if (score > 0.10) action = "ENTER";
      else if (score < -0.10) action = "EXIT";
      else action = "WAIT";
    }

    return {
      action,
      score,
      strength,
      dominantHorizon: dominantByAbsContribution(comps),
      blockers: Array.from(blockersSet),
      components: comps
    };
  }

  /**
   * Compute final decision combining bias and timing
   */
  private computeFinal(
    bias: BiasResolved,
    timing: TimingResolved,
    entPen: number,
    tPen: number
  ): FinalResolved {
    // If timing says WAIT, final is HOLD
    if (timing.action === "WAIT") {
      return {
        mode: "HOLD",
        action: "HOLD",
        sizeMultiplier: 0,
        reason: timing.blockers.length
          ? `Blocked: ${timing.blockers.join(", ")}`
          : "Timing not aligned",
        riskAdjustment: { entropyPenalty: entPen, tailPenalty: tPen }
      };
    }

    const biasDir = bias.dir;
    const timingSign = timing.score >= 0 ? 1 : -1;

    // Trend-follow: bias agrees with timing
    const agrees =
      (biasDir === "BULL" && timingSign > 0) ||
      (biasDir === "BEAR" && timingSign < 0);

    // Counter-trend: timing enters opposite of bias
    const counter =
      (biasDir === "BULL" && timingSign < 0) ||
      (biasDir === "BEAR" && timingSign > 0);

    let mode: FinalResolved["mode"] = "HOLD";
    let action: FinalResolved["action"] = "HOLD";

    if (agrees) {
      mode = "TREND_FOLLOW";
      action = timingSign > 0 ? "BUY" : "SELL";
    } else if (counter) {
      mode = "COUNTER_TREND";
      action = timingSign > 0 ? "BUY" : "SELL";
    } else {
      // NEUTRAL bias: allow small entry/exit
      mode = "TREND_FOLLOW";
      action = timingSign > 0 ? "BUY" : "SELL";
    }

    // Calculate size multiplier
    let size = clamp01(bias.strength * timing.strength);
    if (biasDir === "NEUTRAL") size *= 0.35;
    if (mode === "COUNTER_TREND") size *= 0.25;

    // Final safety haircut
    size *= (1 - 0.35 * entPen);
    size *= (1 - 0.35 * tPen);

    const reason =
      agrees ? "Timing aligned with global Bias" :
      counter ? "Counter-trend entry (reduced size)" :
      "Bias neutral; reduced size";

    return {
      mode,
      action,
      sizeMultiplier: clamp01(size),
      reason,
      riskAdjustment: { entropyPenalty: entPen, tailPenalty: tPen }
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// SINGLETON
// ═══════════════════════════════════════════════════════════════

let _instance: HierarchicalResolverService | null = null;

export function getHierarchicalResolver(): HierarchicalResolverService {
  if (!_instance) {
    _instance = new HierarchicalResolverService();
  }
  return _instance;
}
