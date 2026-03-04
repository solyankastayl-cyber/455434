/**
 * VERDICT STABILITY GUARD
 * =======================
 * 
 * P3: Smart Caching Layer - Block 5
 * Prevents verdict from "jerking" due to micro-noise in features/funding/volatility.
 * 
 * Stabilizes:
 * - direction (UP/DOWN/FLAT)
 * - confidence
 * - expectedMovePct
 * - action (BUY/SELL/HOLD/AVOID)
 * - positionSize
 * 
 * Does NOT touch:
 * - Raw price series
 * - Raw model outputs (for transparency)
 * - Outcome tracking / learning
 * 
 * Rules:
 * 1. If "shock" (macro regime change, confident flip, funding shock) → pass through immediately
 * 2. Otherwise → apply EMA smoothing + sticky direction
 */

import { VerdictStabilityStore, StableVerdictState, verdictStabilityStore } from './verdict-stability.store.js';

type Direction = 'UP' | 'DOWN' | 'FLAT';
type Action = 'BUY' | 'SELL' | 'HOLD' | 'AVOID';

export type IncomingVerdict = {
  symbol: string;
  ts: number;

  direction: Direction;
  confidenceAdjusted: number;
  expectedMovePctAdjusted: number;
  action: Action;
  positionSize: number;

  // Context for shock detection
  macroRegime?: string;
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'EXTREME';
  fundingCrowdedness?: number;
};

export type StabilizedVerdict = IncomingVerdict & {
  stable: {
    direction: Direction;
    confidence: number;
    expectedMovePct: number;
    action: Action;
    positionSize: number;
    meta: {
      shock?: boolean;
      smoothed?: boolean;
      prevDirection?: Direction;
      prevConfidence?: number;
    };
  };
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

function ema(prev: number, next: number, alpha: number): number {
  return prev + alpha * (next - prev);
}

function isDirectionFlip(a: Direction, b: Direction): boolean {
  return (a === 'UP' && b === 'DOWN') || (a === 'DOWN' && b === 'UP');
}

export class VerdictStabilityGuard {
  // EMA smoothing factors
  private readonly confidenceAlpha = 0.35;
  private readonly moveAlpha = 0.25;
  
  // Shock detection thresholds
  private readonly fundingShockThreshold = 0.25;
  private readonly confidentFlipThreshold = 0.55;
  private readonly actionChangeConfidenceDelta = 0.08;
  
  // Sticky direction requires 2 confirmations
  private readonly stickyDirectionCount = 2;

  constructor(private store: VerdictStabilityStore = verdictStabilityStore) {}

  /**
   * Apply stability smoothing to incoming verdict
   */
  apply(v: IncomingVerdict): StabilizedVerdict {
    const symbol = v.symbol.toUpperCase();
    const prev = this.store.get(symbol);

    // First time for this symbol — no smoothing
    if (!prev) {
      const init: StableVerdictState = {
        symbol,
        ts: v.ts,
        direction: v.direction,
        confidence: clamp01(v.confidenceAdjusted),
        expectedMovePct: v.expectedMovePctAdjusted,
        action: v.action,
        positionSize: v.positionSize,
        pendingDirection: undefined,
        pendingCount: 0,
        lastMacroRegime: v.macroRegime,
        lastRiskLevel: v.riskLevel,
        lastFundingCrowdedness: v.fundingCrowdedness,
      };
      this.store.set(symbol, init);
      return this.toOutput(init, v);
    }

    // --- SHOCK DETECTION ---
    const macroChanged = v.macroRegime && prev.lastMacroRegime && v.macroRegime !== prev.lastMacroRegime;
    
    const riskShock = v.riskLevel && (v.riskLevel === 'HIGH' || v.riskLevel === 'EXTREME');
    
    const fundingShock =
      typeof v.fundingCrowdedness === 'number' &&
      typeof prev.lastFundingCrowdedness === 'number' &&
      Math.abs(v.fundingCrowdedness - prev.lastFundingCrowdedness) > this.fundingShockThreshold;

    const directionFlip = isDirectionFlip(prev.direction, v.direction);
    const confidentFlip = directionFlip && v.confidenceAdjusted >= this.confidentFlipThreshold;

    const shock = !!macroChanged || !!fundingShock || confidentFlip || (riskShock && v.action !== prev.action);

    if (shock) {
      const next: StableVerdictState = {
        ...prev,
        ts: v.ts,
        direction: v.direction,
        confidence: clamp01(v.confidenceAdjusted),
        expectedMovePct: v.expectedMovePctAdjusted,
        action: v.action,
        positionSize: v.positionSize,
        pendingDirection: undefined,
        pendingCount: 0,
        lastMacroRegime: v.macroRegime ?? prev.lastMacroRegime,
        lastRiskLevel: v.riskLevel ?? prev.lastRiskLevel,
        lastFundingCrowdedness: typeof v.fundingCrowdedness === 'number' ? v.fundingCrowdedness : prev.lastFundingCrowdedness,
      };
      this.store.set(symbol, next);
      return this.toOutput(next, v, { shock: true });
    }

    // --- NORMAL SMOOTHING ---

    // 1) Sticky direction (need 2 confirmations to change)
    let dir = prev.direction;
    let pendingDirection = prev.pendingDirection;
    let pendingCount = prev.pendingCount ?? 0;

    if (v.direction !== prev.direction) {
      if (pendingDirection !== v.direction) {
        pendingDirection = v.direction;
        pendingCount = 1;
      } else {
        pendingCount += 1;
      }

      if (pendingCount >= this.stickyDirectionCount) {
        dir = v.direction;
        pendingDirection = undefined;
        pendingCount = 0;
      }
    } else {
      pendingDirection = undefined;
      pendingCount = 0;
    }

    // 2) EMA for confidence/move
    const confidence = clamp01(ema(prev.confidence, v.confidenceAdjusted, this.confidenceAlpha));
    const move = ema(prev.expectedMovePct, v.expectedMovePctAdjusted, this.moveAlpha);

    // 3) Action/position — keep previous if confidence delta is small
    const confDelta = Math.abs(v.confidenceAdjusted - prev.confidence);
    const action = (v.action !== prev.action && confDelta < this.actionChangeConfidenceDelta) ? prev.action : v.action;
    const positionSize = (v.action !== prev.action && confDelta < this.actionChangeConfidenceDelta) ? prev.positionSize : v.positionSize;

    const next: StableVerdictState = {
      ...prev,
      ts: v.ts,
      direction: dir,
      confidence,
      expectedMovePct: move,
      action,
      positionSize,
      pendingDirection,
      pendingCount,
      lastMacroRegime: v.macroRegime ?? prev.lastMacroRegime,
      lastRiskLevel: v.riskLevel ?? prev.lastRiskLevel,
      lastFundingCrowdedness: typeof v.fundingCrowdedness === 'number' ? v.fundingCrowdedness : prev.lastFundingCrowdedness,
    };

    this.store.set(symbol, next);
    return this.toOutput(next, v, { shock: false, smoothed: true });
  }

  private toOutput(state: StableVerdictState, raw: IncomingVerdict, flags?: any): StabilizedVerdict {
    return {
      ...raw,
      stable: {
        direction: state.direction,
        confidence: state.confidence,
        expectedMovePct: state.expectedMovePct,
        action: state.action,
        positionSize: state.positionSize,
        meta: {
          ...(flags ?? {}),
          prevDirection: raw.direction,
          prevConfidence: raw.confidenceAdjusted,
        },
      },
    };
  }

  /**
   * Clear stability state for a symbol or all
   */
  clear(symbol?: string) {
    this.store.clear(symbol);
  }

  /**
   * Get store statistics
   */
  stats() {
    return {
      symbols: this.store.size(),
      keys: this.store.keys(),
    };
  }
}

// Singleton instance
export const verdictStabilityGuard = new VerdictStabilityGuard();

console.log('[VerdictStabilityGuard] Module loaded');
