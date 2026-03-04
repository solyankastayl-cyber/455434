/**
 * P11 — Capital Allocation Optimizer Service
 * 
 * Small deltas wrapper on top of Brain allocations.
 * NOT a replacement for policy — just fine-tuning.
 * 
 * Formula:
 *   score = expectedTilt - tailPenalty - corrPenalty - guardPenalty
 *   delta = clamp(score * K, -maxDelta, +maxDelta)
 */

import {
  OptimizerInput,
  OptimizerOutput,
  OptimizerMode,
  AssetRationale,
  Posture,
  Scenario,
  OPTIMIZER_PARAMS,
  clamp,
  clamp01,
  round4,
} from './optimizer.contract.js';

export class OptimizerService {

  /**
   * Main optimizer computation
   */
  compute(input: OptimizerInput, mode: OptimizerMode = 'on'): OptimizerOutput {
    const { K, W_RETURN, W_TAIL, W_CORR, W_GUARD } = OPTIMIZER_PARAMS;
    const { allocations, posture, scenario, crossAssetRegime, contagionScore, forecasts, asOf } = input;
    
    // ─────────────────────────────────────────────────────────
    // 1. Determine max delta allowed
    // ─────────────────────────────────────────────────────────
    
    let maxDeltaAllowed = OPTIMIZER_PARAMS.MAX_DELTA_BASE;
    let defensiveCapApplied = false;
    
    if (posture === 'DEFENSIVE') {
      maxDeltaAllowed = OPTIMIZER_PARAMS.MAX_DELTA_DEFENSIVE;
      defensiveCapApplied = true;
    }
    
    // TAIL allows up to 0.10 but only for risk reduction
    if (scenario === 'TAIL') {
      maxDeltaAllowed = Math.min(maxDeltaAllowed, OPTIMIZER_PARAMS.MAX_DELTA_TAIL);
    }
    
    // ─────────────────────────────────────────────────────────
    // 2. Calculate scores for each asset
    // ─────────────────────────────────────────────────────────
    
    const spxRationale = this.computeAssetScore(
      forecasts.spx.mean,
      forecasts.spx.q05,
      contagionScore,
      posture,
      W_RETURN, W_TAIL, W_CORR, W_GUARD
    );
    
    const btcRationale = this.computeAssetScore(
      forecasts.btc.mean,
      forecasts.btc.q05,
      contagionScore,
      posture,
      W_RETURN, W_TAIL, W_CORR, W_GUARD
    );
    
    // ─────────────────────────────────────────────────────────
    // 3. Convert scores to deltas
    // ─────────────────────────────────────────────────────────
    
    let spxDelta = clamp(spxRationale.score * K, -maxDeltaAllowed, maxDeltaAllowed);
    let btcDelta = clamp(btcRationale.score * K, -maxDeltaAllowed, maxDeltaAllowed);
    
    // ─────────────────────────────────────────────────────────
    // 4. Apply safety constraints
    // ─────────────────────────────────────────────────────────
    
    let tailClampApplied = false;
    let riskOffSyncApplied = false;
    
    // TAIL: only risk reduction allowed (deltas ≤ 0)
    if (scenario === 'TAIL') {
      if (spxDelta > 0) {
        spxDelta = 0;
        tailClampApplied = true;
      }
      if (btcDelta > 0) {
        btcDelta = 0;
        tailClampApplied = true;
      }
    }
    
    // RISK_OFF_SYNC: BTC delta ≤ SPX delta (BTC cut harder)
    if (crossAssetRegime === 'RISK_OFF_SYNC') {
      if (btcDelta > spxDelta) {
        btcDelta = spxDelta;
        riskOffSyncApplied = true;
      }
    }
    
    // ─────────────────────────────────────────────────────────
    // 5. Calculate cash delta (inverse of risk deltas)
    // ─────────────────────────────────────────────────────────
    
    let cashDelta = -(spxDelta + btcDelta);
    
    // ─────────────────────────────────────────────────────────
    // 6. Apply deltas and normalize
    // ─────────────────────────────────────────────────────────
    
    let spxFinal = clamp01(allocations.spx + spxDelta);
    let btcFinal = clamp01(allocations.btc + btcDelta);
    let cashFinal = clamp01(allocations.cash + cashDelta);
    
    // Ensure minimum cash
    if (cashFinal < OPTIMIZER_PARAMS.MIN_CASH) {
      const deficit = OPTIMIZER_PARAMS.MIN_CASH - cashFinal;
      cashFinal = OPTIMIZER_PARAMS.MIN_CASH;
      
      // Take from larger position
      if (spxFinal > btcFinal && spxFinal >= deficit) {
        spxFinal -= deficit;
      } else if (btcFinal >= deficit) {
        btcFinal -= deficit;
      } else {
        // Split deficit
        const half = deficit / 2;
        spxFinal = Math.max(0, spxFinal - half);
        btcFinal = Math.max(0, btcFinal - half);
      }
    }
    
    // Normalize to sum = 1
    const sum = spxFinal + btcFinal + cashFinal;
    if (Math.abs(sum - 1) > 0.001 && sum > 0) {
      const normFactor = 1 / sum;
      spxFinal *= normFactor;
      btcFinal *= normFactor;
      cashFinal *= normFactor;
    }
    
    // Recalculate actual deltas after normalization
    const actualSpxDelta = round4(spxFinal - allocations.spx);
    const actualBtcDelta = round4(btcFinal - allocations.btc);
    const actualCashDelta = round4(cashFinal - allocations.cash);
    
    return {
      mode,
      asOf,
      maxDeltaAllowed: round4(maxDeltaAllowed),
      deltas: {
        spx: actualSpxDelta,
        btc: actualBtcDelta,
        cash: actualCashDelta,
      },
      final: {
        spx: round4(spxFinal),
        btc: round4(btcFinal),
        cash: round4(cashFinal),
      },
      rationale: {
        spx: spxRationale,
        btc: btcRationale,
      },
      constraints: {
        tailClampApplied,
        riskOffSyncApplied,
        defensiveCapApplied,
      },
      applied: mode === 'on',
    };
  }

  /**
   * Compute score for a single asset
   */
  private computeAssetScore(
    mean: number,
    q05: number,
    contagionScore: number,
    posture: Posture,
    W_RETURN: number,
    W_TAIL: number,
    W_CORR: number,
    W_GUARD: number
  ): AssetRationale {
    // Expected tilt from mean return
    const expectedTilt = round4(mean * W_RETURN);
    
    // Tail penalty from q05 (left tail)
    const tailPenalty = round4(Math.abs(q05) * W_TAIL);
    
    // Correlation/contagion penalty
    const corrPenalty = round4(contagionScore * W_CORR);
    
    // Guard penalty for defensive posture
    const guardPenalty = round4(posture === 'DEFENSIVE' ? W_GUARD : 0);
    
    // Final score
    const score = round4(expectedTilt - tailPenalty - corrPenalty - guardPenalty);
    
    return {
      expectedTilt,
      tailPenalty,
      corrPenalty,
      guardPenalty,
      score,
    };
  }

  /**
   * Preview optimizer without applying
   */
  preview(input: OptimizerInput): OptimizerOutput {
    return this.compute(input, 'preview');
  }
}

// Singleton
let instance: OptimizerService | null = null;

export function getOptimizerService(): OptimizerService {
  if (!instance) {
    instance = new OptimizerService();
  }
  return instance;
}
